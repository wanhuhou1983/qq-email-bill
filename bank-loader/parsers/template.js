/**
 * bank-loader/parsers/template.js — 新建一家银行拷贝此文件
 *
 * 新建步骤:
 *   1. 复制为 bank-loader/parsers/xxx.js
 *   2. 填写下面标注 ⚡ 的配置
 *   3. 实现 parse() 函数解析HTML
 *   4. 运行: node bank-loader/loader.js xxx
 */
"use strict";

const bank = {
  // ⚡ 银行信息
  code: "XXX",
  name: "银行名称",
  defaultCardholder: "持卡人",
  defaultCardLast4: "0000",

  // ⚡ QQ邮箱配置
  qqFolder: "其他文件夹/XXX银行",
  searchFrom: "bankname", // 发件人关键词
  searchQueries: [{ from: "bankname" }, { subject: "对账单" }],

  // ⚡ 邮箱编码类型: qp / base64 / utf8 / gbk (loader自动处理)
  //   qp     = quoted-printable (浙商)
  //   base64 = base64 encoded (民生)
  //   gbk   = GB2312/GB18030 (光大)
  //   utf8  = 普通UTF-8 (平安)
  // encoding 字段对 decodeEmail 自动检测已足够，一般不需要设

  /**
   * parse() — 解析HTML，返回标准化数据
   *
   * @param {string} html — 已解码的UTF-8 HTML
   * @param {object} envelope — 邮件元信息 { subject, date, from }
   * @returns {{ billInfo: object, transactions: array }}
   *
   * billInfo 格式:
   *   billDate     — 账单日 YYYY-MM-DD
   *   dueDate      — 到期日 YYYY-MM-DD
   *   billCycle    — 账期 YYYY-MM (如 2026-04)
   *   cycleStart   — 周期起始 YYYY-MM-DD
   *   cycleEnd     — 周期截止 YYYY-MM-DD
   *   cardLast4    — 卡号末4位
   *   cardholder   — 持卡人姓名
   *
   * transactions[] 每项:
   *   trans_date   — 交易日 YYYY-MM-DD  (必填)
   *   post_date    — 记账日 YYYY-MM-DD  (必填)
   *   description  — 交易描述，保持原文 (必填)
   *   amount       — 金额 (+消费, -还款) (必填)
   *   card_last4   — 卡号末4位 (可选，默认用 defaultCardLast4)
   *   cardholder   — 持卡人 (可选，默认用 defaultCardholder)
   */
  parse(html, envelope) {
    // TODO: 实现解析逻辑
    const transactions = [];
    const billInfo = {};

    return { billInfo, transactions };
  },
};

module.exports = bank;
