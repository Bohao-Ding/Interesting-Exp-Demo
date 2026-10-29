# 卡门涡街 / Kármán Vortex Street

自编二维 GPU CFD 圆柱绕流演示，观察交替脱涡、剪切层与尾流。支持流速、涡量和流向色图，叠加随流粒子轨迹。

A custom 2D GPU CFD simulation of flow around a cylinder, showing alternating vortex shedding, shear layers, and the wake. View speed, vorticity, or flow direction with particle trails.

![圆柱绕流与脱涡 / Cylinder flow and vortex shedding](assets/preview.png)

![局部流场 / Wake detail](assets/detail.png)

## 运行 / Run

需要 Rust stable（edition 2024）和开启硬件加速、支持 WebGPU 的浏览器。Windows MSVC 环境需要 C++ 构建工具与 Windows SDK。从仓库根目录运行：

Requires Rust stable with edition 2024 support and a WebGPU-capable browser with hardware acceleration. Windows MSVC builds require C++ Build Tools and the Windows SDK. Run from the repository root:

```powershell
cargo run --release --manifest-path karman-vortex/Cargo.toml
```

打开 <http://127.0.0.1:8766/>，等待流场预演化至 `tU∞/D≈64`。Rust 提供本地服务，求解与显示在浏览器 GPU 上执行。结束时关闭页面，再在终端按 `Ctrl+C`。

Open <http://127.0.0.1:8766/> and allow the flow to advance to `tU∞/D≈64`. Rust serves local files; computation and rendering run on the browser GPU. To stop, close the page and press `Ctrl+C` in the terminal.

## 交互 / Controls

- 滚轮缩放、拖拽平移、双击恢复全域；空格暂停，F 全屏。/ Wheel to zoom, drag to pan, double-click to fit the domain; Space pauses and F toggles fullscreen.
- 自动网格随缩放在 1536×512、2304×768、3072×1024 间切换；手动还可选择 1152×384。/ Automatic grids follow zoom at 1536×512, 2304×768, or 3072×1024; manual mode also offers 1152×384.
- 加密覆盖整个物理域，并通过插值续算已有尾流。/ Refinement covers the full physical domain and continues the wake through interpolation.
- 修改 Re 后点击“重新生成”；演化速度控制每帧步数。/ After changing Re, click “重新生成” (Regenerate); evolution speed sets steps per frame.
- PNG 截图与 8 秒 WebM 录制保存到 `output/`。/ PNG images and eight-second WebM recordings are saved to `output/`.

## 模型与显示 / Model and display

采用弱可压缩、等温 D2Q9 格子玻尔兹曼方法，TRT 碰撞与 pull streaming。默认 `Re=150`、格子来流速度 `U∞=0.07`。圆柱为无滑移反弹边界；入口定速，上下自由滑移，出口为零梯度外推与海绵层。

Uses a weakly compressible, isothermal D2Q9 lattice Boltzmann method with TRT collision and pull streaming. Defaults are `Re=150` and lattice inflow speed `U∞=0.07`. Boundaries comprise no-slip bounce-back at the cylinder, prescribed inlet velocity, free-slip upper and lower walls, and a zero-gradient outlet with a sponge layer.

流速采用蓝至红的顺序色图，涡量采用蓝红发散色图，流向采用周期色图。16,384 个有限寿命粒子通过 RK2 积分显示输运。网格重映射采用双线性插值与 TRT 非平衡模态重标度，属于全域均匀加密。

Speed uses a sequential blue-to-red map, vorticity a diverging blue/red map, and direction a cyclic map. A set of 16,384 finite-lifetime particles uses RK2 to show transport. Grid remapping uses bilinear interpolation and TRT non-equilibrium mode rescaling on a globally uniform grid.

模型用于二维层流脱涡；脱涡频率与细节受有限域、边界和网格重映射影响。

The model represents 2D laminar shedding; the finite domain, boundaries, and remapping affect shedding frequency and flow detail.

## 数值检查与资料 / Verification and details

访问 <http://127.0.0.1:8766/?verify=1> 可查看全域场扫描与尾流探针估计的 Strouhal 数。数据和图片分别位于 `validation/` 与 `assets/`。

Open <http://127.0.0.1:8766/?verify=1> for field scans and a wake-probe estimate of the Strouhal number. Data and preview images are in `validation/` and `assets/`.

[结果说明 / Results](VALIDATION.md) · [Zou & He 边界条件 / Boundary conditions](https://arxiv.org/abs/comp-gas/9611001) · [TRT 方法 / TRT method](https://www.global-sci.com/cicp/article/view/5523)
