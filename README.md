# Interesting Exp Demo

有趣的科学与计算实验动画。每个实验使用独立子目录，并在自己的 README 中说明依赖、启动、关闭和计算范围。

## 实验目录

| 目录 | 实验 | 启动说明 |
|---|---|---|
| `navier-stokes` | Navier–Stokes 爆破解演示动画：局部自相似涡核、旋转层与上下排出通道 | [README](navier-stokes/README.md) |
| `karman-vortex` | 自编 GPU CFD 卡门涡街：圆柱绕流、流速/涡量/流向、缩放与自动网格加密 | [README](karman-vortex/README.md) |
| `kelvin-helmholtz` | 自编 GPU CFD 剪切不稳定：双剪切层、示踪物卷吸、高密度网格与缩放平移 | [README](kelvin-helmholtz/README.md) |
| `wingtip-vortex` | 自编三维 GPU CFD：NASA CRM-HL 参考翼面、研究型翼刀 / 扰流板与自然尾迹 | [README](wingtip-vortex/README.md) |

新增实验时在仓库根目录建立独立子目录，并更新此索引。

三维机翼翼尖涡的实际 CFD 画面，采用公开参考翼面与研究型翼刀 / 扰流板。运行方式见 [实验说明](wingtip-vortex/README.md)，FP32 性能优化实测见 [结果记录](wingtip-vortex/VALIDATION.md)。

![三维机翼翼尖涡 CFD 图片预览](wingtip-vortex/assets/performance-preview.png)

## 获取与运行

```powershell
git clone https://github.com/Bohao-Ding/Interesting-Exp-Demo.git
cd Interesting-Exp-Demo
cargo run --release --manifest-path karman-vortex/Cargo.toml
```

以上命令启动卡门涡街实验，随后打开 `http://127.0.0.1:8766`。安装依赖、操作和关闭方式见各实验 README；克隆仓库本身不会启动计算。
