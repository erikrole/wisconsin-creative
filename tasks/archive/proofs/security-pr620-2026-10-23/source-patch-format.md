# Retained source snapshots

Source patches are stored as lossless `.patch.gz` files so diff-context whitespace is preserved without being mistaken for source whitespace. The `sourcePatchSha256` values in capture metadata refer to the uncompressed patch bytes. Use `gzip -dc <name>.patch.gz` to inspect or verify a snapshot. Image hashes and capture provenance are unchanged.
