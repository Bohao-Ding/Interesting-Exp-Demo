# Kelvin–Helmholtz 剪切不稳定 / Shear Instability

自编二维 GPU CFD 演示：中央流层向右、上下流层向左，初始扰动使剪切层卷起为猫眼涡。两色示踪物显示卷吸、拉伸与混合。

A custom 2D GPU CFD simulation in which a rightward central layer meets leftward outer layers. Initial perturbations roll the shear layers into cat's-eye vortices, while two-color tracers reveal entrainment, stretching, and mixing.

![剪切层与猫眼涡 / Shear layers and cat's-eye vortices](assets/preview.png)

## 运行 / Run

需要 Rust stable（edition 2024）及支持 WebGPU、开启硬件加速的浏览器。Windows MSVC 环境需要 C++ 构建工具与 Windows SDK。从仓库根目录运行：

Requires Rust stable with edition 2024 support and a WebGPU-capable browser with hardware acceleration. Windows MSVC builds require C++ Build Tools and the Windows SDK. Run from the repository root:

```powershell
cargo run --release --manifest-path kelvin-helmholtz/Cargo.toml
```

打开 <http://127.0.0.1:8767/>。Rust 提供本地服务，求解和显示在浏览器 GPU 上执行。结束时关闭页面，再在终端按 `Ctrl+C`。

Open <http://127.0.0.1:8767/>. Rust serves local files; computation and rendering run on the browser GPU. To stop, close the page and press `Ctrl+C` in the terminal.

## 交互 / Controls

- 滚轮缩放、拖拽或方向键平移，双击或 Home 恢复全域；空格暂停，F 全屏。/ Wheel to zoom, drag or use arrow keys to pan, double-click or press Home to fit the domain; Space pauses and F toggles fullscreen.
- 自动网格在 1536×768、2048×1024、2560×1280 间切换，手动模式还提供 1024×512。/ Automatic grids range from 1536×768 through 2048×1024 to 2560×1280; manual mode also offers 1024×512.
- 切换示踪物、涡量或流速，并可显示速度箭头。/ View tracer concentration, vorticity, or speed, with optional velocity arrows.
- 修改 Re 后点击“重新开始”；循环模式在 `tU/H=6` 后重置并预演化。/ After changing Re, click “重新开始” (Restart); loop mode resets after `tU/H=6` and advances the initial flow.
- PNG 截图保存到 `output/preview.png`。/ PNG snapshots are saved to `output/preview.png`.

## 模型 / Model

流体使用 D2Q9 TRT 格子玻尔兹曼方法，计算域为 `2H×H`，四边周期。默认 `Re=UH/ν=5000`、格子速度 `U=0.05`。平滑双剪切层叠加多波长横向扰动；示踪物满足对流扩散方程，`κ=ν`。

The fluid uses a D2Q9 TRT lattice Boltzmann method on a `2H×H` doubly periodic domain. Defaults are `Re=UH/ν=5000` and lattice speed `U=0.05`. Smooth double shear layers carry multi-wavelength transverse perturbations. The tracer follows an advection–diffusion equation with `κ=ν`.

示踪物采用 MC 限幅 MUSCL 重构与 SSP-RK2。缩放触发全域均匀网格重映射，保持物理区域、Re 和演化时间。模型为弱可压缩二维流动；网格插值误差和长时间 FP32 密度漂移见结果说明。

Tracer transport uses MC-limited MUSCL reconstruction and SSP-RK2. Zoom-triggered global remapping preserves the physical domain, Re, and simulation time. The model is weakly compressible and two-dimensional; remapping error and long-run FP32 density drift are documented in the results.

## 数值检查与资料 / Verification and details

访问 <http://127.0.0.1:8767/?verify=1> 可运行剪切波衰减、示踪物对流扩散解析对照及全域场扫描，结果保存到 `output/validation.json`。

Open <http://127.0.0.1:8767/?verify=1> to run analytical shear-wave and tracer-transport checks plus field scans. Results are saved to `output/validation.json`.

[结果说明 / Results](VALIDATION.md) · [Lecoanet et al.：KH 数值问题 / KH test problem](https://arxiv.org/abs/1509.03630)
