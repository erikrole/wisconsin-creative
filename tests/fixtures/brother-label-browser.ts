import { renderBrotherLabel, verifyBrotherQr } from "@/lib/brother-label-render";

// The real renderer and QR check, exposed for tests/browser/brother-label.spec.ts.
Object.assign(window, { renderBrotherLabel, verifyBrotherQr });
