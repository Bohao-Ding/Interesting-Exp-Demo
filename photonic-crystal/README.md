# 光子晶体与电磁波传播 / Photonic Crystal and Electromagnetic Waves

自编二维 Maxwell / Yee FDTD 演示。在空气中的介质柱阵列里，通过移除或缩小晶柱形成直通道、弯道和点缺陷微腔，观察电磁波传播与局域场。

A custom 2D Maxwell / Yee FDTD simulation. Removing or shrinking dielectric rods in air creates straight waveguides, bends, and point-defect cavities for exploring wave propagation and localized fields.

![缺陷弯道电场 / Electric field in a defect bend](assets/optimized.png)

![微腔平均电场强度 / Mean electric-field intensity in a cavity](assets/cavity.png)

## 运行 / Run

需要 Rust stable（edition 2021）和支持 WebGPU、开启硬件加速的浏览器。Windows MSVC 环境需要 C++ 构建工具与 Windows SDK。从仓库根目录运行：

Requires Rust stable with edition 2021 support and a WebGPU-capable browser with hardware acceleration. Windows MSVC builds require C++ Build Tools and the Windows SDK. Run from the repository root:

```powershell
cargo run --release --manifest-path photonic-crystal/Cargo.toml
```

打开 <http://127.0.0.1:8769/>。Rust 提供本地服务，求解与显示在浏览器 GPU 上执行。结束时关闭页面，再在终端按 `Ctrl+C`。

Open <http://127.0.0.1:8769/>. Rust serves local files; computation and rendering run on the browser GPU. To stop, close the page and press `Ctrl+C` in the terminal.

## 交互 / Controls

- 拖拽平移，滚轮缩放，双击或“全域”复位。/ Drag to pan, wheel to zoom, and double-click or choose “全域” (Fit) to reset the view.
- 调节归一化频率 `fa/c=0.20–0.48`；调频保留当前场与光源相位。/ Adjust normalized frequency over `fa/c=0.20–0.48`; frequency changes preserve the field and source phase.
- 选择完整晶体、直通道、90° 弯道或微腔，也可点击编辑单根晶柱。/ Choose a complete crystal, straight channel, 90° bend, or cavity, or edit individual rods by clicking.
- 网格为 1024×768、2048×1536 或 3072×2304；改变网格或结构会重置场。/ Grids are 1024×768, 2048×1536, or 3072×2304; grid or structure changes reset the field.
- 蓝 / 橙表示瞬时电场的负 / 正值，强度模式显示指数平均 `〈Ez²〉`。/ Blue/orange shows negative/positive instantaneous electric field; intensity mode shows exponentially averaged `〈Ez²〉`.
- 可关闭光源观察逸散，或将 PNG 图片与检查结果保存到 `output/`。/ Switch off the source to observe decay, or save PNG images and check results to `output/`.

## 模型 / Model

采用二维 TM 极化：`Ez` 垂直截面，`Hx,Hy` 位于平面。计算域为 `32a×24a`，柱半径 `0.20a`，相对介电常数为 12。材料按无色散、无吸收、沿 z 无限延伸的介质处理。

The model uses 2D TM polarization: `Ez` is normal to the plane, while `Hx,Hy` lie in it. The domain is `32a×24a`; rods have radius `0.20a` and relative permittivity 12. Materials are nondispersive, lossless, and invariant along z.

Yee 交错网格以 FP32 推进，`cΔt/Δx=0.65`，边缘设 2a 宽的分裂场 PML。光源为平滑起振的高斯空间电流。内核在 32×8 工作组中更新 H/E，采用双缓冲场存储。

An FP32 Yee staggered grid advances with `cΔt/Δx=0.65` and a split-field PML of width 2a. A Gaussian spatial current source turns on smoothly. The kernel updates H/E in 32×8 workgroups using double-buffered fields.

微腔使用中心光源，其他构型使用左侧光源；`fa/c=0.380` 可作为微腔观察起点。强度图表示局部场强，透射率测量需要另外定义入射功率与通量截面。

The cavity uses a central source; other configurations use a source on the left. A frequency of `fa/c=0.380` is a useful starting point for viewing the cavity. Intensity maps show local fields; transmission measurements require defined incident power and flux sections.

## 数据与参考 / Data and references

界面提供周期平面波、吸收脉冲与缺陷通道的数值检查。

The interface provides numerical checks for periodic plane waves, absorbing boundaries, and defect channels.

[数值结果 / Numerical results](validation/numerical-optimized.json) · [光子晶体背景 / Photonic-crystal background](https://mpb.readthedocs.io/en/latest/Scheme_Tutorial/) · [缺陷导光与微腔 / Defect waveguides and cavities](https://math.mit.edu/~stevenj/papers/JohnsonPo01-SPIE.pdf) · [Berenger PML](https://doi.org/10.1006/jcph.1994.1159)
