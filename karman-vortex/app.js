const $ = id => document.getElementById(id);
const canvas = $('canvas');
const U0 = 0.07;
const PARTICLES = 16384;
let device, context, pipelines, renderPipeline, trailPipeline, paramsBuffer, remeshPipeline;
let buffers = [], fieldBuffer, particleBuffer, groups, renderGroup;
let nx, ny, radius, reynolds, current = 0, steps = 0, frame = 0;
let paused = false, spinning = false, running = true, view = 1, trails = true;
let lastStats = performance.now(), statsSteps = 0, statsFrames = 0;
let screenshotRequested = false, busyReset = false, recording = false;
let verification;
let simulationTime = 0, remeshTimer;
let frameWork = Promise.resolve();
const camera = {x: 0.5, y: 0.5, zoom: 1};
const uniforms = new ArrayBuffer(80);
const ints = new Uint32Array(uniforms);
const floats = new Float32Array(uniforms);

function fail(error) {
    running = false;
    $('loading').classList.remove('hidden');
    $('loading-title').textContent = '无法启动 GPU 求解';
    $('loading-text').textContent = error.message || String(error);
    $('progress').hidden = true;
    $('status').textContent = '求解已停止';
    console.error(error);
}

function writeParams(dt = 0, scale = 0) {
    const tau = 0.5 + 3 * U0 * (2 * radius) / reynolds;
    ints.set([nx, ny, nx * ny, view]);
    floats.set([ny * 0.58, ny * 0.5, radius, U0, 1 / tau,
        1 / (0.5 + (3 / 16) / (tau - 0.5)), steps, dt,
        Number(trails), canvas.width / canvas.height, frame, scale,
        camera.x, camera.y, camera.zoom, 0], 4);
    device.queue.writeBuffer(paramsBuffer, 0, uniforms);
}

function dispatch(pass, name, countX = Math.ceil(nx / 16), countY = Math.ceil(ny / 16)) {
    pass.setPipeline(pipelines[name]);
    pass.setBindGroup(0, groups[current]);
    pass.dispatchWorkgroups(countX, countY);
}

function solve(encoder, count, updateParticles) {
    const pass = encoder.beginComputePass();
    for (let i = 0; i < count; i++) {
        dispatch(pass, 'collide_stream');
        current = 1 - current;
    }
    dispatch(pass, 'extract_field');
    if (updateParticles) dispatch(pass, 'advect_particles', PARTICLES / 128, 1);
    pass.end();
    steps += count;
    simulationTime += count * U0 / (2 * radius);
}

function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
    }
}

function draw(encoder) {
    const pass = encoder.beginRenderPass({colorAttachments: [{view: context.getCurrentTexture().createView(),
        clearValue: {r: 0.03, g: 0.05, b: 0.08, a: 1}, loadOp: 'clear', storeOp: 'store'}]});
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderGroup);
    pass.draw(3);
    if (trails) {
        pass.setPipeline(trailPipeline);
        pass.draw(6, PARTICLES * 7);
    }
    pass.end();
}

function updateGridLabels() {
    $('re-value').innerHTML = `${reynolds}<small>Re</small>`;
    $('cells').textContent = (nx * ny).toLocaleString('en-US');
    $('plot-info').textContent = `${nx} × ${ny}  /  Δx = D/${2 * radius}`;
}

function allocateGrid() {
    buffers = [0, 1].map(() => device.createBuffer({size: nx * ny * 9 * 4, usage: GPUBufferUsage.STORAGE}));
    fieldBuffer = device.createBuffer({size: nx * ny * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
    groups = [0, 1].map(i => device.createBindGroup({layout: pipelines.initialize.getBindGroupLayout(0), entries: [
        {binding: 0, resource: {buffer: paramsBuffer}}, {binding: 1, resource: {buffer: buffers[i]}},
        {binding: 2, resource: {buffer: buffers[1 - i]}}, {binding: 3, resource: {buffer: fieldBuffer}},
        {binding: 4, resource: {buffer: particleBuffer}}]}));
    renderGroup = device.createBindGroup({layout: renderPipeline.getBindGroupLayout(0), entries: [
        {binding: 0, resource: {buffer: paramsBuffer}}, {binding: 1, resource: {buffer: fieldBuffer}},
        {binding: 2, resource: {buffer: particleBuffer}}]});
}

async function reset() {
    busyReset = true; spinning = true;
    await frameWork;
    await device.queue.onSubmittedWorkDone();
    verification?.dispose(); verification = undefined;
    for (const b of [...buffers, fieldBuffer, particleBuffer]) b?.destroy();
    camera.x = 0.5; camera.y = 0.5; camera.zoom = 1;
    $('zoom-level').textContent = '1.0×';
    nx = $('quality').value === 'auto' ? 1536 : Number($('quality').value);
    ny = nx / 3; radius = ny / 16;
    reynolds = Number($('re').value);
    current = 0; steps = 0; frame = 0; simulationTime = 0;
    updateGridLabels();
    $('loading').classList.remove('hidden');
    $('loading-title').textContent = '让尾流自然形成';
    $('progress').hidden = false;
    $('reset').disabled = true;
    $('quality').disabled = true; $('re').disabled = true;
    $('status').textContent = '预演化流场';
    resize(); writeParams();
    particleBuffer = device.createBuffer({size: PARTICLES * 72, usage: GPUBufferUsage.STORAGE});
    allocateGrid();
    let encoder = device.createCommandEncoder();
    let pass = encoder.beginComputePass();
    dispatch(pass, 'initialize'); current = 1; dispatch(pass, 'initialize'); current = 0;
    dispatch(pass, 'initialize_particles', PARTICLES / 128, 1); pass.end();
    device.queue.submit([encoder.finish()]);
    // Spin-up is genuine solver evolution, never a prescribed vortex pattern.
    const goal = Math.ceil(64 * 2 * radius / U0 / 128) * 128;
    const start = performance.now();
    while (steps < goal && running) {
        writeParams();
        encoder = device.createCommandEncoder();
        solve(encoder, 128, false); draw(encoder);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        $('progress').value = steps / goal;
        $('loading-text').textContent = `预演化 ${Math.round(100 * steps / goal)}% · ${(steps * U0 / (2 * radius)).toFixed(1)} D / U∞ · ${((performance.now() - start) / 1000).toFixed(0)} 秒`;
    }
    if (!running) return;
    encoder = device.createCommandEncoder();
    pass = encoder.beginComputePass();
    dispatch(pass, 'initialize_particles', PARTICLES / 128, 1); pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    lastStats = performance.now(); statsSteps = steps; statsFrames = 0;
    $('loading').classList.add('hidden');
    $('reset').disabled = false; $('quality').disabled = false; $('re').disabled = false;
    $('status').textContent = paused ? '已暂停' : 'GPU 实时求解中';
    if (location.search.includes('verify')) {
        const { createVerification } = await import('./verification.js');
        verification = await createVerification(device, fieldBuffer, {nx, ny, radius, reynolds, u0: U0, steps, time: simulationTime});
    }
    spinning = false; busyReset = false;
    queueRemesh();
}

function desiredMesh() {
    if ($('quality').value !== 'auto') return Number($('quality').value);
    return camera.zoom > 3.2 ? 3072 : camera.zoom > 1.6 ? 2304 : 1536;
}

function queueRemesh() {
    clearTimeout(remeshTimer);
    remeshTimer = setTimeout(() => {
        if (!busyReset && device && running && desiredMesh() !== nx) remesh(desiredMesh()).catch(fail);
    }, 350);
}

async function remesh(width) {
    busyReset = true; spinning = true;
    $('reset').disabled = true;
    $('status').textContent = width > nx ? '正在加密网格…' : '正在调整网格…';
    await frameWork;
    await device.queue.onSubmittedWorkDone();
    verification?.dispose(); verification = undefined;
    const previousBuffers = buffers, previousField = fieldBuffer, previousCurrent = current;
    const oldNx = nx, oldNy = ny, oldRadius = radius;
    nx = width; ny = width / 3; radius = ny / 16;
    const ratio = ny / oldNy;
    const oldTau = 0.5 + 6 * U0 * oldRadius / reynolds;
    const newTau = 0.5 + 6 * U0 * radius / reynolds;
    const oldOdd = 0.5 + (3 / 16) / (oldTau - 0.5);
    const newOdd = 0.5 + (3 / 16) / (newTau - 0.5);
    const oldUniforms = new ArrayBuffer(32);
    new Uint32Array(oldUniforms).set([oldNx, oldNy, oldNx * oldNy, 0]);
    new Float32Array(oldUniforms).set([ratio, (newTau - 1) / (oldTau - 1) / ratio,
        (newOdd - 1) / (oldOdd - 1) / ratio, 0], 4);
    const oldParams = device.createBuffer({size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(oldParams, 0, oldUniforms);
    allocateGrid(); current = 0; writeParams(0, ratio);
    const transfer = device.createBindGroup({layout: remeshPipeline.getBindGroupLayout(0), entries: [
        {binding: 0, resource: {buffer: paramsBuffer}}, {binding: 1, resource: {buffer: oldParams}},
        {binding: 2, resource: {buffer: previousBuffers[previousCurrent]}}, {binding: 3, resource: {buffer: buffers[0]}}]});
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(remeshPipeline); pass.setBindGroup(0, transfer);
    pass.dispatchWorkgroups(Math.ceil(nx / 16), Math.ceil(ny / 16));
    dispatch(pass, 'extract_field');
    dispatch(pass, 'rescale_particles', PARTICLES / 128, 1);
    pass.end(); draw(encoder); device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    for (const buffer of [...previousBuffers, previousField, oldParams]) buffer.destroy();
    if (location.search.includes('verify')) {
        const { createVerification } = await import('./verification.js');
        verification = await createVerification(device, fieldBuffer, {nx, ny, radius, reynolds, u0: U0, steps, time: simulationTime});
    }
    updateGridLabels(); lastStats = performance.now(); statsSteps = steps; statsFrames = 0;
    $('status').textContent = paused ? '已暂停' : 'GPU 实时求解中';
    $('reset').disabled = recording; spinning = false; busyReset = false;
    queueRemesh();
}

function viewFit() {
    const rect = canvas.getBoundingClientRect(), aspect = rect.width / rect.height;
    return {x: Math.max(aspect / 3, 1), y: Math.max(3 / aspect, 1)};
}
function constrainCamera() {
    const fit = viewFit();
    for (const key of ['x', 'y']) {
        const half = Math.min(0.5, fit[key] / (2 * camera.zoom));
        camera[key] = Math.max(half, Math.min(1 - half, camera[key]));
    }
}
function zoomAt(factor, mouseX = 0.5, mouseY = 0.5) {
    const next = Math.max(1, Math.min(16, camera.zoom * factor));
    const fit = viewFit();
    camera.x += (mouseX - 0.5) * fit.x * (1 / camera.zoom - 1 / next);
    camera.y += (0.5 - mouseY) * fit.y * (1 / camera.zoom - 1 / next);
    camera.zoom = next; constrainCamera();
    $('zoom-level').textContent = `${next.toFixed(1)}×`;
    queueRemesh();
}
canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * 0.0015), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
}, {passive: false});
let drag;
canvas.addEventListener('pointerdown', event => {
    drag = {x: event.clientX, y: event.clientY};
    canvas.focus({preventScroll: true});
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect(), fit = viewFit();
    camera.x -= (event.clientX - drag.x) / rect.width * fit.x / camera.zoom;
    camera.y += (event.clientY - drag.y) / rect.height * fit.y / camera.zoom;
    drag = {x: event.clientX, y: event.clientY}; constrainCamera();
});
canvas.addEventListener('pointerup', () => { drag = undefined; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointercancel', () => { drag = undefined; canvas.classList.remove('dragging'); });
function fitView() {
    camera.x = camera.y = 0.5; camera.zoom = 1;
    $('zoom-level').textContent = '1.0×'; queueRemesh();
}
canvas.addEventListener('dblclick', fitView);
$('zoom-in').onclick = () => zoomAt(1.5);
$('zoom-out').onclick = () => zoomAt(1 / 1.5);
$('fit').onclick = fitView;
$('quality').onchange = queueRemesh;

async function saveAsset(path, blob, button, label) {
    const response = await fetch(`/save/${path}`, {method: 'POST', body: blob});
    if (!response.ok) throw Error('保存失败，请确认本地服务仍在运行。');
    button.textContent = '已保存';
    setTimeout(() => { button.textContent = label; }, 1800);
}

function capture() {
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    const k = out.width / 1500;
    ctx.fillStyle = '#d8e9ef'; ctx.font = `${15 * k}px Segoe UI`;
    ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
    ctx.fillText(`VON KÁRMÁN VORTEX STREET  /  ${['SPEED', 'VORTICITY', 'DIRECTION'][view]}`, 24 * k, 30 * k);
    ctx.font = `${12 * k}px Consolas`;
    ctx.fillText(`Re ${reynolds}  ·  ${nx} × ${ny}  ·  tU/D ${simulationTime.toFixed(2)}  ·  ${camera.zoom.toFixed(1)}x  ·  D2Q9 / TRT`, 24 * k, out.height - 20 * k);
    out.toBlob(blob => saveAsset('preview.png', blob, $('snapshot'), '截图').catch(console.error));
}

async function renderFrame() {
    resize();
    const count = paused ? 0 : Number($('speed').value);
    writeParams(count);
    const encoder = device.createCommandEncoder();
    if (count) solve(encoder, count, true);
    verification?.sample(encoder, steps);
    draw(encoder);
    device.queue.submit([encoder.finish()]);
    if (screenshotRequested) { capture(); screenshotRequested = false; }
    await device.queue.onSubmittedWorkDone();
    await verification?.collect();
    frame++; statsFrames++;
    const now = performance.now(), elapsed = (now - lastStats) / 1000;
    if (elapsed >= 0.8) {
        $('time').textContent = simulationTime.toFixed(1);
        $('throughput').textContent = ((steps - statsSteps) * nx * ny / elapsed / 1e6).toFixed(0);
        $('fps').textContent = (statsFrames / elapsed).toFixed(0);
        lastStats = now; statsSteps = steps; statsFrames = 0;
    }
}

async function tick() {
    if (!running) return;
    if (!spinning) {
        frameWork = renderFrame();
        await frameWork;
    }
    requestAnimationFrame(() => tick().catch(fail));
}

function setView(index) {
    view = index;
    for (const button of $('views').children) button.classList.toggle('active', Number(button.dataset.view) === view);
    $('plot-title').textContent = ['流速 / SPEED MAGNITUDE', '涡量 / VORTICITY', '流向 / VELOCITY DIRECTION'][view];
    $('scale-name').textContent = ['|u| / U∞', 'ω D / U∞', '速度矢量的方向'][view];
    $('scale-labels').innerHTML = ['<span>0</span><span>0.8</span><span>1.65</span>', '<span>−5</span><span>0</span><span>+5</span>', '<span>←</span><span>↓</span><span>→</span><span>↑</span><span>←</span>'][view];
    $('scale-bar').style.background = [
        'linear-gradient(90deg,#07173b,#085b9e,#05a6a6,#85cc61,#ffaa26,#d62233)',
        'linear-gradient(90deg,#1fb2eb,#0d344f,#071018,#571a22,#ff543b)',
        'linear-gradient(90deg,#ff5555,#8f2ef0,#1fc6c6,#8fef2e,#ff5555)'][view];
}
function pause() {
    paused = !paused; $('pause').textContent = paused ? '继续' : '暂停';
    $('status').textContent = paused ? '已暂停' : 'GPU 实时求解中';
}
async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('viewport').requestFullscreen();
}
$('views').addEventListener('click', event => { if (event.target.dataset.view) setView(Number(event.target.dataset.view)); });
$('trails').onclick = () => { trails = !trails; $('trails').classList.toggle('active', trails); $('trails').setAttribute('aria-pressed', trails); };
$('pause').onclick = pause;
$('snapshot').onclick = () => { screenshotRequested = true; };
$('record').onclick = () => {
    if (!window.MediaRecorder || !canvas.captureStream) return;
    const stream = canvas.captureStream(60);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 18000000});
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        $('record').disabled = false; $('record').textContent = '录制 8 秒';
        recording = false; $('reset').disabled = busyReset;
        try { await saveAsset('recording.webm', new Blob(chunks, {type: mimeType}), $('record'), '录制 8 秒'); }
        catch (error) { console.error(error); }
    };
    recording = true; $('record').disabled = true; $('record').textContent = '录制中…'; $('reset').disabled = true;
    recorder.start(); setTimeout(() => recorder.stop(), 8000);
};
$('fullscreen').onclick = () => fullscreen().catch(console.error);
$('reset').onclick = () => { if (!busyReset) reset().catch(fail); };
document.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
    const directions = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]};
    if (directions[event.code]) {
        event.preventDefault();
        const [x, y] = directions[event.code], fit = viewFit();
        camera.x += x * 0.16 * fit.x / camera.zoom;
        camera.y += y * 0.16 * fit.y / camera.zoom;
        constrainCamera();
    }
    if (event.code === 'Home') { event.preventDefault(); fitView(); }
    if (event.code === 'Space') { event.preventDefault(); pause(); }
    if (event.code === 'KeyF') fullscreen().catch(console.error);
});
setView(1);

async function start() {
    if (!navigator.gpu) throw Error('浏览器未提供 WebGPU。请使用开启硬件加速的 Chrome / Edge，通过本地 HTTP 地址打开。');
    const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
    if (!adapter) throw Error('没有可用的 WebGPU 适配器。请在 Chrome / Edge 中开启硬件加速。');
    device = await adapter.requestDevice();
    device.lost.then(info => fail(Error(`GPU 连接中断：${info.message}`)));
    device.addEventListener('uncapturederror', event => fail(event.error));
    const info = adapter.info;
    $('gpu-name').textContent = `${info.vendor || ''} ${info.device || info.architecture || 'WebGPU'}`.trim();
    context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({device, format, alphaMode: 'opaque'});
    paramsBuffer = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const [computeSource, renderSource, remeshSource] = await Promise.all(['simulation.wgsl', 'render.wgsl', 'remesh.wgsl'].map(async url => (await fetch(url)).text()));
    const computeModule = device.createShaderModule({code: computeSource});
    const renderModule = device.createShaderModule({code: renderSource});
    const remeshModule = device.createShaderModule({code: remeshSource});
    for (const module of [computeModule, renderModule, remeshModule]) {
        const compilation = await module.getCompilationInfo();
        const errors = compilation.messages.filter(message => message.type === 'error');
        if (errors.length) throw Error(errors.map(message => `行 ${message.lineNum}: ${message.message}`).join('\n'));
    }
    const computeLayout = device.createBindGroupLayout({entries: [
        {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
        {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
        ...[2, 3, 4].map(binding => ({binding, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}))]});
    const layout = device.createPipelineLayout({bindGroupLayouts: [computeLayout]});
    const names = ['initialize', 'collide_stream', 'extract_field', 'initialize_particles', 'advect_particles', 'rescale_particles'];
    pipelines = Object.fromEntries(await Promise.all(names.map(async entryPoint => [entryPoint,
        await device.createComputePipelineAsync({layout, compute: {module: computeModule, entryPoint}})])));
    remeshPipeline = await device.createComputePipelineAsync({layout: 'auto', compute: {module: remeshModule, entryPoint: 'remesh'}});
    const renderLayout = device.createBindGroupLayout({entries: [
        {binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}},
        {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {type: 'read-only-storage'}},
        {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'read-only-storage'}}]});
    const pipelineLayout = device.createPipelineLayout({bindGroupLayouts: [renderLayout]});
    renderPipeline = await device.createRenderPipelineAsync({layout: pipelineLayout,
        vertex: {module: renderModule, entryPoint: 'fullscreen'}, fragment: {module: renderModule, entryPoint: 'flow', targets: [{format}]}});
    trailPipeline = await device.createRenderPipelineAsync({layout: pipelineLayout,
        vertex: {module: renderModule, entryPoint: 'trail_vertex'}, fragment: {module: renderModule, entryPoint: 'trail_fragment',
            targets: [{format, blend: {color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add'},
                alpha: {srcFactor: 'zero', dstFactor: 'one', operation: 'add'}}}]}});
    await reset();
    $('record').disabled = !window.MediaRecorder || !canvas.captureStream;
    tick().catch(fail);
}
start().catch(fail);
