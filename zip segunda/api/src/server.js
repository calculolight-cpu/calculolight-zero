import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";

dotenv.config();
const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || "calculolight_super_secret_2026";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

app.use(cors({
  origin: ["http://localhost:5173","http://localhost:5174",process.env.APP_URL,process.env.SITE_URL].filter(Boolean),
}));
app.use(express.json());

function requireAuth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({ error:"Token ausente" });
  try { req.auth=jwt.verify(token, jwtSecret); return next(); }
  catch { return res.status(401).json({ error:"Token inválido" }); }
}

function buildCalculation(input){
  const widthUseful = Number(input.width_mm) - 4;
  const heightUseful = Number(input.height_mm) - 4;
  const isDoor = input.typology === "Porta Pivotante ACM";
  const profiles = isDoor
    ? [
      { profile:`Montante ${input.line}`, cut_mm:heightUseful, quantity:2 },
      { profile:`Travessa ${input.line}`, cut_mm:widthUseful, quantity:2 },
      { profile:`Batente ${input.line}`, cut_mm:heightUseful, quantity:2 }
    ]
    : [
      { profile:`Trilho Superior ${input.line}`, cut_mm:widthUseful, quantity:1 },
      { profile:`Trilho Inferior ${input.line}`, cut_mm:widthUseful, quantity:1 },
      { profile:`Montante Folha ${input.line}`, cut_mm:heightUseful, quantity:4 },
      { profile:`Travessa Folha ${input.line}`, cut_mm:Math.round(widthUseful/2), quantity:4 }
    ];
  const glasses = isDoor
    ? [{ glass:input.glass, width_mm:widthUseful-120, height_mm:heightUseful-180, quantity:1 }]
    : [{ glass:input.glass, width_mm:Math.round(widthUseful/2)-80, height_mm:heightUseful-100, quantity:2 }];
  return {
    opening_clearance:{
      width_input_mm:Number(input.width_mm),
      height_input_mm:Number(input.height_mm),
      width_useful_mm:widthUseful,
      height_useful_mm:heightUseful
    },
    profiles,
    glasses,
    purchase_list:{
      profiles:profiles.map((p)=>({ profile:p.profile, bars_needed:Math.max(1, Math.ceil((p.cut_mm*p.quantity)/6000)), total_waste_mm:0 })),
      glasses
    },
    pricing:{ sale_total:isDoor ? 3350 : 2190 }
  };
}

app.get("/", (_,res)=>res.json({ ok:true, app:"Cálculo Light API", message:"Servidor ativo" }));

app.get("/api/health", async (_,res)=>{
  try {
    await pool.query("SELECT 1");
    res.json({ ok:true, app:"Cálculo Light API", database:"connected" });
  } catch (error) {
    res.status(500).json({ ok:false, app:"Cálculo Light API", database:"error", error:error.message });
  }
});

app.post("/api/auth/login", async (req,res)=>{
  try {
    const { email, password } = req.body || {};
    const result = await pool.query("SELECT * FROM users WHERE email = $1 LIMIT 1",[email]);
    const user = result.rows[0];
    if(!user) return res.status(401).json({ error:"Login inválido" });
    const ok = await bcrypt.compare(password, user.password_hash);
    if(!ok) return res.status(401).json({ error:"Login inválido" });
    const token = jwt.sign({ userId:user.id, companyId:user.company_id, email:user.email, role:user.role }, jwtSecret, { expiresIn:"7d" });
    res.json({ token, user:{ id:user.id, email:user.email, role:user.role } });
  } catch (error) {
    res.status(500).json({ error:error.message || "Erro ao fazer login" });
  }
});

app.get("/api/clients", requireAuth, async (req,res)=>{
  try {
    const result = await pool.query("SELECT * FROM clients WHERE company_id = $1 ORDER BY id DESC",[req.auth.companyId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error:error.message || "Erro ao listar clientes" });
  }
});

app.get("/api/quotes", requireAuth, async (req,res)=>{
  try {
    const result = await pool.query("SELECT * FROM quotes WHERE company_id = $1 ORDER BY id DESC",[req.auth.companyId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error:error.message || "Erro ao listar orçamentos" });
  }
});

app.post("/api/quotes", requireAuth, async (req,res)=>{
  try {
    const calc = buildCalculation(req.body || {});
    const p = req.body || {};
    const result = await pool.query(
      "INSERT INTO quotes (company_id, client_name, typology, line, width_mm, height_mm, color, glass, quantity, total_value, status, calculation_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
      [req.auth.companyId, p.client_name, p.typology, p.line, Number(p.width_mm), Number(p.height_mm), p.color, p.glass, Number(p.quantity || 1), calc.pricing.sale_total, p.status || "Enviado", JSON.stringify(calc)]
    );
    res.status(201).json({ quote: result.rows[0], calculation: calc });
  } catch (error) {
    res.status(400).json({ error:error.message || "Erro ao criar orçamento" });
  }
});

app.get("/api/billing/plans", async (_,res)=>{
  try {
    const result = await pool.query("SELECT id, code, name, description, price_cents, currency, interval_unit, interval_count, trial_days FROM billing_plans WHERE is_active = TRUE ORDER BY price_cents ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error:error.message || "Erro ao listar planos" });
  }
});

app.listen(port, ()=>console.log(`API rodando em http://localhost:${port}`));
