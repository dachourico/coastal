import { loadPyodide } from './runtime/pyodide.mjs';
const ready = (async () => {
  const py = await loadPyodide({indexURL: new URL('runtime/', self.location.href).href});
  py.FS.mkdirTree('/app/clone_master');
  const files = ['coastal_core.py', 'room_layout.py', 'inventory_import.py', 'strain_catalog.py', 'app_paths.py', 'clone_master/strains.py', 'bridge.py'];
  await Promise.all(files.map(async name => {
    const response = await fetch(`python/${name}`);
    if (!response.ok) throw new Error(`Could not load ${name}`);
    py.FS.writeFile(`/app/${name}`, await response.text());
  }));
  await py.runPythonAsync("import sys; sys.path.insert(0, '/app'); from bridge import dispatch");
  return py;
})();
let queue = Promise.resolve();
let excelLoaded = false;
self.onmessage = ({data: {id, request}}) => {
  queue = queue.then(async () => {
    try {
      const py = await ready;
      if (request.action === 'import' && /\.xlsx?$/i.test(request.filename) && !excelLoaded) {
        const response = await fetch('runtime/excel-wheels.json');
        if (!response.ok) throw new Error('Could not load Excel support');
        for (const name of await response.json()) {
          const wheel = await fetch(`runtime/${name}`);
          if (!wheel.ok) throw new Error('Could not download Excel support');
          py.FS.writeFile('/tmp/excel.whl', new Uint8Array(await wheel.arrayBuffer()));
          await py.runPythonAsync("import zipfile; zipfile.ZipFile('/tmp/excel.whl').extractall('/app')");
        }
        excelLoaded = true;
      }
      py.globals.set('request_json', JSON.stringify(request));
      const result = JSON.parse(await py.runPythonAsync('dispatch(request_json)'));
      self.postMessage({id, result});
    } catch (error) {
      const message = String(error.message).trim().split('\n').filter(Boolean).pop();
      self.postMessage({id, error: message});
    }
  });
};
