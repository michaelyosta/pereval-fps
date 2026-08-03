# Asset pipeline

`concepts/oblomok-7-concept.png` is an original Image Gen concept reference for the «ОБЛОМОК-7» visual direction. It is intentionally not loaded at runtime: the playable scene remains procedural so the build has no remote asset dependency and the concept cannot mask gameplay or performance issues.

Runtime world and character materials are generated locally with CanvasTexture. Color textures are tagged `THREE.SRGBColorSpace`; scalar detail maps (bump/roughness) stay in the renderer's non-color space. A future production asset pass can replace individual procedural maps through the manifest below without changing gameplay code.
