import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { isSerializationConflict } from "@/lib/serialization";

const MAX_CATEGORY_TREE_DEPTH = 25;
const CATEGORY_MUTATION_ATTEMPTS = 2;

type CategoryGraphNode = {
  id: string;
  name: string;
  parentId: string | null;
};

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  return (error as { code?: unknown }).code;
}

/**
 * A category-tree mutation must retry the whole transaction, including all
 * duplicate and ancestry reads. That is what makes reciprocal parent moves and
 * root-category duplicates converge on one valid result instead of committing
 * against stale snapshots.
 */
export async function withCategorySerializableRetry<T>(operation: () => Promise<T>) {
  for (let attempt = 1; attempt <= CATEGORY_MUTATION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error)) throw error;
      if (attempt === CATEGORY_MUTATION_ATTEMPTS) {
        throw new HttpError(409, "Category changed at the same time; please try again");
      }
    }
  }

  throw new HttpError(409, "Category changed at the same time; please try again");
}

export async function loadCategoryGraph(
  tx: Prisma.TransactionClient,
): Promise<CategoryGraphNode[]> {
  return tx.category.findMany({
    select: { id: true, name: true, parentId: true },
  });
}

function proposedParentDepth(
  nodesById: ReadonlyMap<string, CategoryGraphNode>,
  categoryId: string | null,
  proposedParentId: string | null,
) {
  if (!proposedParentId) return -1;
  if (categoryId === proposedParentId) {
    throw new HttpError(400, "Category cannot be its own parent");
  }

  const seen = new Set<string>();
  let currentId: string | null = proposedParentId;
  let depth = 0;
  let isProposedParent = true;

  while (currentId) {
    if (categoryId === currentId) {
      throw new HttpError(400, "Category cannot be moved under one of its subcategories");
    }
    if (seen.has(currentId)) {
      throw new HttpError(409, "Category parent chain contains a cycle");
    }
    seen.add(currentId);

    const current = nodesById.get(currentId);
    if (!current) {
      if (isProposedParent) {
        throw new HttpError(404, "Parent category not found");
      }
      throw new HttpError(409, "Category parent chain is invalid");
    }

    if (current.parentId) {
      depth += 1;
    }
    currentId = current.parentId;
    isProposedParent = false;
  }

  return depth;
}

function deepestDescendantHeight(
  graph: readonly CategoryGraphNode[],
  categoryId: string | null,
) {
  if (!categoryId) return 0;

  const childrenByParent = new Map<string, CategoryGraphNode[]>();
  for (const node of graph) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const seen = new Set([categoryId]);
  const pending: Array<{ id: string; height: number }> = [{ id: categoryId, height: 0 }];
  let deepest = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;

    for (const child of childrenByParent.get(current.id) ?? []) {
      if (seen.has(child.id)) {
        throw new HttpError(409, "Category parent chain contains a cycle");
      }
      seen.add(child.id);

      const height = current.height + 1;
      deepest = Math.max(deepest, height);
      pending.push({ id: child.id, height });
    }
  }

  return deepest;
}

/**
 * Validate a placement from one transaction-consistent graph snapshot. The
 * maximum applies to the resulting root-to-leaf path, including every
 * descendant that moves with the category.
 */
export function assertValidCategoryPlacement(
  graph: readonly CategoryGraphNode[],
  categoryId: string | null,
  proposedParentId: string | null,
) {
  const nodesById = new Map(graph.map((node) => [node.id, node]));
  const parentDepth = proposedParentDepth(nodesById, categoryId, proposedParentId);
  const subtreeHeight = deepestDescendantHeight(graph, categoryId);
  const resultingDeepestDepth = parentDepth + 1 + subtreeHeight;

  if (resultingDeepestDepth > MAX_CATEGORY_TREE_DEPTH) {
    throw new HttpError(400, "Category tree cannot exceed 25 parent-child edges");
  }
}

export function rethrowCategoryMutationError(
  error: unknown,
  options: { foreignKeyMessage?: string; notFoundMessage?: string } = {},
): never {
  if (error instanceof HttpError) throw error;

  const code = prismaErrorCode(error);
  if (isSerializationConflict(error)) {
    throw new HttpError(409, "Category changed at the same time; please try again");
  }
  if (code === "P2002") {
    throw new HttpError(409, "Category already exists in this level");
  }
  if (code === "P2003" && options.foreignKeyMessage) {
    throw new HttpError(409, options.foreignKeyMessage);
  }
  if (code === "P2025" && options.notFoundMessage) {
    throw new HttpError(404, options.notFoundMessage);
  }
  throw error;
}
