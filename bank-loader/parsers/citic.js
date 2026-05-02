"use strict"; const s=require("./bank_shared");
module.exports=s.makeBank({ code:"CITIC", name:"中信银行", cardholder:"吴华辉", qqFolder:"其他文件夹/中信银行", searchFrom:"citic", searchQueries:[{from:"citic"},{subject:"中信银行信用卡"}] });
