# Protocol references and limits

- [Exact-model ptouch-print transport](https://git.familie-radermacher.ch/linux/ptouch-print.git/tree/src/libptouch.c): D610 flags, D460-family magic, n9=2, chain K00 with an actual fifth zero, 1A page ending.
- [ptouch-print page path](https://git.familie-radermacher.ch/linux/ptouch-print.git/tree/src/ptouch-print.c): per-page raster-mode, info, magic, precut, chain, raster; init outside print_img.
- [Brother D610 tape-cutting guide](https://origin.supportbrothercom.brother.co.jp/g/s/es/htmldoc/ptouch/d610bt/canen/html/GUID-DD3FA04F-C0F9-48B6-B7F4-4E1D864207BB_1.html): chain leaves last label held; physical Feed & Cut required.
- [Brother related-model raster reference](https://download.brother.com/welcome/docp100064/cv_pte550wp750wp710bt_eng_raster_102.pdf): intermediate USB acknowledgements may precede physical completion; phase type and phase number distinguish feed from idle. This does not prove D610-specific finalization commands.
- [ptouch-go candidate finish](https://github.com/crmin/ptouch-go/blob/56074f4aa0b2/prepare.go): zero-raster page header. D610 is absent from supported profiles; this was only a hypothesis and failed the D610 physical probe.
- [ptouch-rs feed/cut candidate](https://github.com/vowstar/ptouch-rs/blob/main/crates/ptouch-core/src/transport.rs): one blank raster normal job. Not tested on this printer; never enabled.

Source review was independent and read-only. K08 finalization, five-byte K08, conditional n9 and a one-blank-raster flush are not accepted protocol facts. Failed trials are retained; no speculative chain default or hidden cleanup feed was added.
