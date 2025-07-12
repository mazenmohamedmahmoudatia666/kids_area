// 1. استدعاء مكتبة pg (PostgreSQL)
const { Pool } = require("pg");

// 2. استدعاء متغيرات البيئة من .env
require("dotenv").config();

// 3. إنشاء connection pool (بتربط بالسيرفر)
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT), // ← ✅ حولها لـ Number
  ssl: {
    rejectUnauthorized: false, // ✅ تمام كده لـ Railway
  },
});

// 4. تصدير الاتصال علشان نستخدمه في ملفات تانية
module.exports = pool;
