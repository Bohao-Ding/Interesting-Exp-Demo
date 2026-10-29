# 磁重联与电流片 / Magnetic Reconnection and Current Sheets

自编二维不可压缩电阻磁流体演示，观察双电流片在多尺度不规则初始扰动下的演化、磁岛结构与流体运动，呈现太阳耀斑相关的局部磁重联机制。

A custom 2D incompressible resistive MHD simulation of two current sheets with irregular, multi-scale initial perturbations. It visualizes magnetic islands, fluid motion, and a local reconnection mechanism relevant to solar flares.

![电流片与磁力线 / Current sheets and magnetic field lines](assets/preview.png)

蓝 / 橙表示负 / 正电流密度，细线为平面内磁力线。预览工况：512² 网格、扰动 0.30、`η=0.003`、`t≈6.6`。

Blue/orange indicates negative/positive current density; thin lines trace the in-plane magnetic field. Preview conditions: 512² grid, perturbation 0.30, `η=0.003`, and `t≈6.6`.

## 运行 / Run

需要 Rust stable（edition 2021）和支持 WebGPU、开启硬件加速的浏览器。Windows MSVC 环境需要 C++ 构建工具与 Windows SDK。从仓库根目录运行：

Requires Rust stable with edition 2021 support and a WebGPU-capable browser with hardware acceleration. Windows MSVC builds require C++ Build Tools and the Windows SDK. Run from the repository root:

```powershell
cargo run --release --manifest-path solar-reconnection/Cargo.toml
```

打开 <http://127.0.0.1:8770/>。Rust 提供本地服务，求解与显示在浏览器 GPU 上执行。结束时关闭页面，再在终端按 `Ctrl+C`。

Open <http://127.0.0.1:8770/>. Rust serves local files; computation and rendering run on the browser GPU. To stop, close the page and press `Ctrl+C` in the terminal.

## 交互 / Controls

- 拖拽平移，滚轮缩放，双击或“全域”复位。/ Drag to pan, wheel to zoom, and double-click or choose “全域” (Fit) to reset.
- 网格可选 256²、512² 或 1024²；改变网格会重置计算。/ Choose a 256², 512², or 1024² grid; changing the grid resets the simulation.
- 磁扩散率范围 0.001–0.008，调节时保留当前场。/ Adjust magnetic diffusivity over 0.001–0.008 while retaining the field.
- 初始扰动范围 0.06–0.30，默认 0.20；修改扰动重新生成初始场。/ Initial perturbation ranges from 0.06 to 0.30, with default 0.20; changing it regenerates the initial field.
- 显示可切换欧姆耗散代理量 `ηj²`、电流、涡量或磁场强度；每帧步数控制演化速度。/ Display the Ohmic dissipation proxy `ηj²`, current, vorticity, or field strength; steps per frame control the evolution rate.

## 模型 / Model

计算域为周期正方形 `[0,2π)²`，参考 Alfvén 速度归一化为 1。磁通 A 和流函数 φ 满足：

The domain is the periodic square `[0,2π)²`, with reference Alfvén speed normalized to 1. Magnetic flux A and streamfunction φ satisfy:

```text
B = (∂y A, -∂x A),     u = (∂y φ, -∂x φ)
j = -∇²A,              ω = -∇²φ
[f,g] = ∂x f ∂y g - ∂y f ∂x g
∂t A = [φ,A] - ηj
∂t ω = [φ,ω] + [j,A] + ν∇²ω
```

黏性系数 `ν=0.003`。双电流片叠加不同相位和权重的傅里叶扰动，初始流速为零。空间离散采用有限差分与 Arakawa 括号，泊松方程由自编 FFT 求解，时间推进采用二阶 Adams–Bashforth，计算精度为 FP32。

Viscosity is `ν=0.003`. The two current sheets carry Fourier perturbations with different phases and weights, and the initial fluid velocity is zero. Spatial discretization uses finite differences and Arakawa brackets, a custom FFT solves the Poisson equation, and second-order Adams–Bashforth advances FP32 fields.

这是无量纲的局部磁重联模型；显示的磁岛同时受初始扰动和后续演化影响。`ηj²` 表示局部耗散，温度与辐射需要另行建模。

This is a dimensionless local reconnection model. Magnetic islands reflect both the initial perturbations and subsequent evolution. The quantity `ηj²` represents local dissipation; temperature and radiation require additional models.

## 数据与参考 / Data and references

数值检查覆盖泊松方程、磁扩散、能量收支和指定时刻的网格及时间步对照，可在界面运行。

Numerical checks cover the Poisson equation, magnetic diffusion, energy balance, and grid/time-step comparisons at specified times. They can be run from the interface.

[数值结果 / Numerical results](validation/numerical.json) · [Reduced-MHD 方程 / Equations](https://farside.ph.utexas.edu/teaching/plasma/lectures1/node124.html) · [Arakawa 离散 / Discretization](https://doi.org/10.1016/0021-9991(66)90015-5) · [NASA 太阳耀斑 / Solar flares](https://science.nasa.gov/sun/solar-storms-and-flares/)
