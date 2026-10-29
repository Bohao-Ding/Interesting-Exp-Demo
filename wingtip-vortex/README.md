# 三维机翼翼尖涡 / 3D Wingtip Vortices

自编 WebGPU CFD 风洞，基于 NASA CRM-HL 的 WING01 参考翼面，计算均匀来流经过机翼、翼刀和扰流板形成的三维尾迹。

A custom WebGPU CFD wind tunnel based on the NASA CRM-HL WING01 reference wing, simulating the three-dimensional wake of a wing with fences and spoilers.

![三维机翼与翼尖尾迹 / Wing and tip wake](assets/performance-preview.png)

## 运行 / Run

需要 Rust stable（edition 2021）和支持 WebGPU、开启硬件加速的浏览器。Windows MSVC 环境需要 C++ 构建工具与 Windows SDK。从仓库根目录运行：

Requires Rust stable with edition 2021 support and a WebGPU-capable browser with hardware acceleration. Windows MSVC builds require C++ Build Tools and the Windows SDK. Run from the repository root:

```powershell
cargo run --release --manifest-path wingtip-vortex/Cargo.toml
```

打开 <http://127.0.0.1:8768/>。结束时关闭页面释放 GPU 资源，再在终端按 `Ctrl+C` 停止服务。

Open <http://127.0.0.1:8768/>. To stop, close the page to release GPU resources, then press `Ctrl+C` in the terminal.

## 观察 / Controls

- 左键旋转，右键或 Shift 拖拽平移，滚轮缩放。/ Left-drag to rotate, right-drag or Shift-drag to pan, and wheel to zoom.
- 选择俯视或尾迹视角，切换 Q 或涡量强度，并可叠加表面压力和流线。/ Choose top or wake views, display Q or vorticity magnitude, and optionally overlay surface pressure and streamlines.
- 切换构型、迎角或网格会从均匀来流重新计算；暂停保留流场。/ Changing configuration, angle of attack, or grid restarts from uniform flow; pausing retains the flow field.
- 三档网格约为 65 万、516 万和 1,742 万单元；聚焦翼尖尾迹改变显示区域。/ Three grids contain about 0.65, 5.16, and 17.42 million cells; tip-wake focus changes the displayed region.
- PNG 图片和数值检查结果保存到 `output/`。/ PNG snapshots and numerical-check results are saved to `output/`.

## 几何与模型 / Geometry and model

主翼保留公开曲面的后掠、厚度、弯度、扭转和圆滑翼尖，施加 5° 上反角，并连接翼根构成孤立全翼。两片翼刀和四片抬起 25° 的扰流板为研究扩展；实体与薄板均参与 CFD 边界计算。

The wing retains the source surfaces' sweep, thickness, camber, twist, and rounded tips. It has 5° dihedral and joined roots forming an isolated full wing. Two fences and four spoilers deflected by 25° are research additions; both solid surfaces and thin plates participate in the CFD boundaries.

求解器采用 D3Q19 正则化格子玻尔兹曼方法、Smagorinsky 亚网格黏性（`Cs=0.14`）与 FP32 存储。工况为 `Re_MAC=2000`、格子来流速度 0.07。涡量、Q、压力和流线由求得的速度与密度计算。

The solver uses a D3Q19 regularized lattice Boltzmann method, Smagorinsky subgrid viscosity (`Cs=0.14`), and FP32 storage. The operating condition is `Re_MAC=2000` with lattice inflow speed 0.07. Vorticity, Q, pressure, and streamlines are derived from the computed velocity and density.

模型用于低雷诺数下的大尺度尾迹观察；局部精度受均匀网格、体素边界和近壁分辨率影响。FP16 存储为实验选项，压力与气动力分析使用默认 FP32。

The model is intended for large-scale wake visualization at low Reynolds number. Local accuracy depends on the uniform grid, voxel boundaries, and near-wall resolution. FP16 storage is experimental; use the default FP32 mode for pressure and force analysis.

## 几何生成与资料 / Geometry generation and details

运行所需网格和边界数据位于 `data/`。从公开 STEP 重新生成时，需要 Python、NumPy 和 SciPy：

Runtime geometry and boundary data are in `data/`. Regenerating them from the public STEP file requires Python, NumPy, and SciPy:

```powershell
cd wingtip-vortex
python tools/fetch_geometry.py
python tools/prepare_geometry.py
```

[几何与数值方法 / Geometry and numerical methods](METHODS.md) · [结果说明 / Results](VALIDATION.md) · [几何参数 / Geometry metadata](data/geometry.json)
