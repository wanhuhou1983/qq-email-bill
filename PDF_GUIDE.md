# 银行账单 .eml → PDF 转换

## 前置条件
- Node.js 环境（运行 `html_to_pdf.js`）
- Puppeteer 已安装（`node_modules/puppeteer/`）
- Python 3.x

## 脚本说明

### 1. 提取 HTML + 检测卡号/账期

| 银行 | 脚本 | 编码 |
|:---|:----|:----:|
| 农业银行 | `python batch_abc_pdf.py` | base64 GBK/UTF-8 |
| 工商银行 | `python batch_icbc_pdf.py` | quoted-printable GBK |
| 建设银行 | `python batch_ccb_pdf.py` | base64 UTF-8 |

每个脚本：
- 从 `fetched_{bank}_eml/` 读取 .eml 文件
- 自动检测卡号、持卡人、账单周期
- 输出 HTML 到 `fetched_{bank}_html_pdf/`
- 生成 `pdf_jobs.json`

### 2. 生成 PDF

```bash
node html_to_pdf.js <银行名> <HTML目录> <输出目录>
```

### 3. 一键完成

```bash
python batch_ccb_pdf.py
python batch_icbc_pdf.py
python batch_abc_pdf.py
node html_to_pdf.js 建设银行 fetched_ccb_html_pdf "C:\Users\linhu\Documents\建设银行信用卡账单"
node html_to_pdf.js 工商银行 fetched_icbc_html_pdf "C:\Users\linhu\Documents\工商银行信用卡账单"
node html_to_pdf.js 农业银行 fetched_abc_html_pdf "C:\Users\linhu\Documents\农业银行信用卡账单"
```

## 输出文件名格式

`{银行}-{持卡人}-{起始日期}~{结束日期}.pdf`

## 卡号 → 持卡人映射

### 建设银行：6258/4870/9917→赵健伟, 1855/1077→吴大军, 5099/9025→钱伟琴, 7614/3055→吴华辉
### 工商银行：8888→吴华辉(主), 2411→吴大军(副), 6402→钱伟琴(副), 3751→吴华辉(副)
### 农业银行：8042→吴华辉, 8761→吴大军, 2769→张帆, 7267→赵健伟

## 已知问题
- 同名同周期文件会用 `_1` `_2` 后缀区分
- 无账期文件以 `-seq{序号}.pdf` 命名
