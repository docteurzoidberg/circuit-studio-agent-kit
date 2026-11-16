// Spike: load a project through the dev-server modules and start an Auto Video export.
// Result is kept on window.__spikeExport; poll it, then read window.__spikeExport.base64.
async () => {
  const PROJECT_URL = '/tests/fixtures/crowded-c6-project.json';
  const { useEditor } = await import('/src/store.ts');
  const { importLegacy } = await import('/src/projectFiles.ts');
  const { exportCinematic } = await import('/src/videoExport.ts');
  const { defaultVideoSettings } = await import('/src/cinematic.ts');
  // Same path as the Open button for JSON projects: schema, migrations, connection validation, assets.
  const loaded = await importLegacy(await (await fetch(PROJECT_URL)).json());
  // Workaround (upstream bug): model components saved without modelUrl cannot be exported.
  // Restore the catalog model reference from the built-in part definitions exported by model.ts.
  const modelModule = await import('/src/model.ts');
  const builtIns = Object.values(modelModule).filter(v => v && typeof v === 'object' && typeof v.modelId === 'string' && v.geometry);
  const project = { ...loaded, components: loaded.components.map(c => {
    if (c.geometry?.kind !== 'model' || c.geometry.modelUrl || c.geometry.lodUrls || c.geometry.modelAssetId) return c;
    const catalog = builtIns.find(d => d.modelId === c.modelId)?.geometry;
    return catalog ? { ...c, geometry: { ...catalog, ...Object.fromEntries(Object.entries(c.geometry).filter(([, v]) => v !== undefined)) } } : c;
  }) };
  useEditor.getState().loadProject(project);
  const state = window.__spikeExport = { stage: 'loading', progress: null, error: null, result: null, startedAt: Date.now() };
  (async () => {
    try {
      await new Promise(r => setTimeout(r, 3000));
      state.stage = 'exporting';
      const current = useEditor.getState().project;
      const t0 = performance.now();
      const result = await exportCinematic(current, defaultVideoSettings, [], p => { state.progress = p; });
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      state.base64 = btoa(binary);
      state.result = { filename: result.filename, frames: result.frames, renderSeconds: result.renderSeconds,
        totalSeconds: (performance.now() - t0) / 1000, bytes: bytes.length, duration: result.sequence.duration,
        shots: result.sequence.shots.length, warnings: result.sequence.warnings, peakHeapMB: Math.round(result.peakHeap / 1e6) };
      state.stage = 'done';
    } catch (e) { state.error = String(e?.stack || e); state.stage = 'error'; }
  })();
  return { started: true, components: project.components.length, wires: project.wires.length };
}
