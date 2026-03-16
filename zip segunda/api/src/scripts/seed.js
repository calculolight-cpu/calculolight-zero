import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

async function main(){
  await pool.query("INSERT INTO companies (name, domain, app_domain, api_domain, plan) VALUES ('Cálculo Light','www.calculolight.com','app.calculolight.com','api.calculolight.com','Profissional') ON CONFLICT DO NOTHING");
  const r = await pool.query("SELECT id FROM companies ORDER BY id ASC LIMIT 1");
  const companyId = r.rows[0].id;
  const hash = await bcrypt.hash("123456", 10);
  await pool.query("INSERT INTO users (company_id, name, email, password_hash, role, is_active) VALUES ($1,'Alex Oliveira','master@calculolight.com',$2,'master',TRUE) ON CONFLICT (email) DO NOTHING",[companyId, hash]);
  await pool.query("INSERT INTO clients (company_id, name, project, city) VALUES ($1,'Construtora Alfa','Residencial Primavera','Catalão') ON CONFLICT DO NOTHING",[companyId]).catch(()=>{});
  console.log("Seed concluído.");
  await pool.end();
}
main().catch(async (error)=>{ console.error(error); await pool.end(); process.exit(1); });
