export async function createKernels(device) {
    const texts = await Promise.all(['simulation.wgsl', 'remesh.wgsl'].map(async path => (await fetch(path)).text()));
    const modules = texts.map(code => device.createShaderModule({code}));
    for (const module of modules) {
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(item => item.type === 'error');
        if (errors.length) throw Error(errors.map(item => `行 ${item.lineNum}: ${item.message}`).join('\n'));
    }
    const groupLayout = device.createBindGroupLayout({entries: [
        {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
        ...[1, 2, 3, 4, 5].map(binding => ({binding, visibility: GPUShaderStage.COMPUTE,
            buffer: {type: [1, 4].includes(binding) ? 'read-only-storage' : 'storage'}}))]});
    const layout = device.createPipelineLayout({bindGroupLayouts: [groupLayout]});
    const entries = ['initialize', 'collide_stream', 'extract_field', 'dye_predict', 'dye_correct'];
    const pipelines = Object.fromEntries(await Promise.all(entries.map(async entryPoint => [entryPoint,
        await device.createComputePipelineAsync({layout, compute: {module: modules[0], entryPoint}})])));
    for (const mode of [1, 2]) pipelines[`test${mode}`] = await device.createComputePipelineAsync({layout,
        compute: {module: modules[0], entryPoint: 'initialize', constants: {test_mode: mode}}});
    const remesh = await device.createComputePipelineAsync({layout: 'auto', compute: {module: modules[1], entryPoint: 'remesh'}});
    return {pipelines, remesh, groupLayout};
}

export class Flow {
    constructor(device, kernels, nx, ny, reynolds = 5000) {
        Object.assign(this, {device, kernels, nx, ny, reynolds, u0: 0.05, current: 0, steps: 0, time: 0});
        this.cells = nx * ny;
        this.nu = this.u0 * ny / reynolds;
        this.params = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
        this.populations = [0, 1].map(() => device.createBuffer({size: this.cells * 36, usage: GPUBufferUsage.STORAGE}));
        this.dye = [0, 1].map(() => device.createBuffer({size: this.cells * 4, usage: GPUBufferUsage.STORAGE}));
        this.field = device.createBuffer({size: this.cells * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
        this.groups = [0, 1].map(f => [0, 1].map(q => device.createBindGroup({layout: kernels.groupLayout,
            entries: [this.params, this.populations[f], this.populations[1 - f], this.field, this.dye[q], this.dye[1 - q]]
                .map((buffer, binding) => ({binding, resource: {buffer}}))})));
        this.uniforms = new ArrayBuffer(80);
        this.write();
    }
    write(view = this.view ?? 0, arrows = this.arrows ?? false,
        camera = this.camera ?? {x: 0.5, y: 0.5, zoom: 1}, aspect = this.aspect ?? 2) {
        Object.assign(this, {view, arrows, camera, aspect});
        const tau = 0.5 + 3 * this.nu;
        new Uint32Array(this.uniforms).set([this.nx, this.ny, this.cells, view]);
        new Float32Array(this.uniforms).set([this.u0, this.nu, 1 / tau, 1 / (0.5 + (3 / 16) / (tau - 0.5)),
            4, this.nu, this.time, Number(arrows), camera.x, camera.y, camera.zoom, aspect, 0.025, 4, 0.02, 0], 4);
        this.device.queue.writeBuffer(this.params, 0, this.uniforms);
    }
    dispatch(pass, name, q = 0) {
        pass.setPipeline(this.kernels.pipelines[name]); pass.setBindGroup(0, this.groups[this.current][q]);
        pass.dispatchWorkgroups(Math.ceil(this.nx / 16), Math.ceil(this.ny / 16));
    }
    initialize(mode = 0) {
        const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
        const name = mode ? `test${mode}` : 'initialize';
        this.dispatch(pass, name, 1); this.current = 1; this.dispatch(pass, name); this.current = 0;
        pass.end(); this.device.queue.submit([encoder.finish()]);
    }
    advance(encoder, count) {
        const pass = encoder.beginComputePass();
        for (let i = 0; i < count; i += 4) {
            for (let j = 0; j < 4; j++) {
                this.dispatch(pass, 'collide_stream'); this.current = 1 - this.current;
            }
            this.dispatch(pass, 'extract_field');
            this.dispatch(pass, 'dye_predict'); this.dispatch(pass, 'dye_correct', 1);
        }
        this.dispatch(pass, 'extract_field'); pass.end();
        this.steps += count; this.time += count * this.u0 / this.ny;
    }
    async refine(width) {
        const next = new Flow(this.device, this.kernels, width, width / 2, this.reynolds);
        next.steps = this.steps; next.time = this.time; next.write(this.view, this.arrows, this.camera, this.aspect);
        const ratio = next.ny / this.ny, a = 0.5 + 3 * this.nu, b = 0.5 + 3 * next.nu;
        const oddA = 0.5 + (3 / 16) / (a - 0.5), oddB = 0.5 + (3 / 16) / (b - 0.5);
        const data = new ArrayBuffer(32);
        new Uint32Array(data).set([this.nx, this.ny, this.cells, 0]);
        new Float32Array(data).set([ratio, (b - 1) / (a - 1) / ratio, (oddB - 1) / (oddA - 1) / ratio, 0], 4);
        const oldParams = this.device.createBuffer({size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
        this.device.queue.writeBuffer(oldParams, 0, data);
        const group = this.device.createBindGroup({layout: this.kernels.remesh.getBindGroupLayout(0),
            entries: [next.params, oldParams, this.populations[this.current], this.field, next.populations[0], next.dye[0]]
                .map((buffer, binding) => ({binding, resource: {buffer}}))});
        const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(this.kernels.remesh); pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(Math.ceil(next.nx / 16), Math.ceil(next.ny / 16));
        next.dispatch(pass, 'extract_field'); pass.end(); this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone(); oldParams.destroy(); this.destroy(); return next;
    }
    async readField() {
        const buffer = this.device.createBuffer({size: this.cells * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
        const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(this.field, 0, buffer, 0, buffer.size);
        this.device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
        const copy = new Float32Array(buffer.getMappedRange()).slice(); buffer.unmap(); buffer.destroy(); return copy;
    }
    destroy() { for (const buffer of [this.params, this.field, ...this.populations, ...this.dye]) buffer.destroy(); }
}
