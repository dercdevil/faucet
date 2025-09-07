import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Detectar entorno serverless (Vercel, Netlify, AWS Lambda, etc.)
const isServerless =
  process.env.VERCEL === "1" ||
  process.env.NETLIFY === "true" ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.cwd().includes("/var/task") ||
  process.cwd().includes("/tmp");

// En entornos serverless, usar /tmp que es escribible
// En desarrollo local, usar el directorio del proyecto
const dbPath = isServerless
  ? path.join("/tmp", "faucet.db")
  : path.join(process.cwd(), "faucet.db");

// Función para inicializar la base de datos con permisos correctos
function initializeDatabase(): Database {
  try {
    console.log(`Inicializando base de datos en: ${dbPath}`);
    console.log(`Entorno serverless: ${isServerless}`);
    console.log(`Directorio actual: ${process.cwd()}`);

    if (isServerless) {
      console.warn(
        "⚠️  ADVERTENCIA: En entornos serverless, la base de datos SQLite se almacena en /tmp"
      );
      console.warn(
        "⚠️  Los datos se perderán cuando la función se reinicie (cold start)"
      );
      console.warn(
        "⚠️  Para producción, considera usar una base de datos externa (PostgreSQL, MySQL, etc.)"
      );
    }
    // Verificar si el directorio existe y tiene permisos de escritura
    const dbDir = path.dirname(dbPath);

    // Crear directorio si no existe
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o755 });
    }

    // Verificar permisos del directorio
    try {
      fs.accessSync(dbDir, fs.constants.W_OK);
    } catch {
      console.error(`No se puede escribir en el directorio: ${dbDir}`);
      throw new Error(`Database directory is not writable: ${dbDir}`);
    }

    // Si la base de datos existe, verificar permisos
    if (fs.existsSync(dbPath)) {
      try {
        fs.accessSync(dbPath, fs.constants.W_OK);
      } catch {
        console.error(`Base de datos de solo lectura: ${dbPath}`);
        // Intentar cambiar permisos
        try {
          fs.chmodSync(dbPath, 0o644);
          console.log(`Permisos de base de datos actualizados: ${dbPath}`);
        } catch {
          throw new Error(`Cannot make database writable: ${dbPath}`);
        }
      }
    }

    // Crear conexión a la base de datos
    const database = new Database(dbPath);

    // Configurar SQLite para mejor concurrencia
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    database.exec("PRAGMA cache_size = 1000");
    database.exec("PRAGMA temp_store = memory");

    return database;
  } catch (error) {
    console.error("Error inicializando base de datos:", error);
    throw error;
  }
}

const db = initializeDatabase();

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    wallet TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    attempts INTEGER DEFAULT 1,
    lastAttempt DATETIME DEFAULT CURRENT_TIMESTAMP,
    blockedUntil DATETIME NULL
  )
`);

export interface Claim {
  id: number;
  ip: string;
  wallet: string;
  createdAt: string;
}

export interface RateLimit {
  id: number;
  ip: string;
  attempts: number;
  lastAttempt: string;
  blockedUntil: string | null;
}

// Función para intentar reparar la base de datos
function repairDatabase(): void {
  try {
    console.log("Intentando reparar base de datos...");

    // Cerrar conexión actual si existe
    if (db) {
      try {
        (db as Database & { close(): void }).close();
      } catch {
        // Ignorar errores al cerrar
      }
    }

    // Verificar y corregir permisos
    if (fs.existsSync(dbPath)) {
      try {
        fs.chmodSync(dbPath, 0o644);
        console.log("Permisos de base de datos corregidos");
      } catch {
        console.log(
          "No se pudieron corregir permisos, recreando base de datos..."
        );
        // Si no se pueden corregir permisos, eliminar y recrear
        fs.unlinkSync(dbPath);
      }
    }

    // Verificar permisos del directorio
    const dbDir = path.dirname(dbPath);
    try {
      fs.accessSync(dbDir, fs.constants.W_OK);
    } catch {
      throw new Error(`Database directory is not writable: ${dbDir}`);
    }
  } catch (error) {
    console.error("Error reparando base de datos:", error);
    throw error;
  }
}

// Función auxiliar para manejar reintentos en operaciones SQLite
function withRetry<T>(operation: () => T, maxRetries: number = 3): T {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      return operation();
    } catch (error: unknown) {
      retries++;
      const errorCode = (error as { code?: string }).code;

      if (errorCode === "SQLITE_READONLY" && retries === 1) {
        // En el primer intento con SQLITE_READONLY, intentar reparar
        console.log(
          "Base de datos de solo lectura detectada, intentando reparar..."
        );
        try {
          repairDatabase();
          // Reinicializar la base de datos
          const newDb = initializeDatabase();
          // Reemplazar la referencia global (esto es un hack, pero necesario)
          Object.setPrototypeOf(db, Object.getPrototypeOf(newDb));
          Object.assign(db, newDb);
          continue; // Reintentar la operación
        } catch (repairError) {
          console.error("No se pudo reparar la base de datos:", repairError);
        }
      }

      if (
        (errorCode === "SQLITE_BUSY" || errorCode === "SQLITE_READONLY") &&
        retries < maxRetries
      ) {
        // Esperar un tiempo aleatorio antes de reintentar
        const delay = Math.random() * 100 + 50; // 50-150ms
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
        continue;
      }
      throw error;
    }
  }

  throw new Error("Max retries exceeded");
}

export class FaucetDB {
  static hasClaimedByIP(ip: string): boolean {
    const stmt = db.prepare(
      "SELECT COUNT(*) as count FROM claims WHERE ip = ?"
    );
    const result = stmt.get(ip) as { count: number };
    return result.count > 0;
  }

  static hasClaimedByWallet(wallet: string): boolean {
    const stmt = db.prepare(
      "SELECT COUNT(*) as count FROM claims WHERE LOWER(wallet) = LOWER(?)"
    );
    const result = stmt.get(wallet) as { count: number };
    return result.count > 0;
  }

  static addClaim(ip: string, wallet: string): void {
    withRetry(() => {
      const stmt = db.prepare("INSERT INTO claims (ip, wallet) VALUES (?, ?)");
      stmt.run(ip, wallet);
    });
  }

  static getAllClaims(): Claim[] {
    const stmt = db.prepare("SELECT * FROM claims ORDER BY createdAt DESC");
    return stmt.all() as Claim[];
  }

  static getClaimsByIP(ip: string): Claim[] {
    const stmt = db.prepare(
      "SELECT * FROM claims WHERE ip = ? ORDER BY createdAt DESC"
    );
    return stmt.all(ip) as Claim[];
  }

  static getClaimsByWallet(wallet: string): Claim[] {
    const stmt = db.prepare(
      "SELECT * FROM claims WHERE LOWER(wallet) = LOWER(?) ORDER BY createdAt DESC"
    );
    return stmt.all(wallet) as Claim[];
  }

  // Rate limiting methods
  static checkRateLimit(ip: string): {
    allowed: boolean;
    blockedUntil?: Date;
    attempts?: number;
  } {
    return withRetry(() => {
      const stmt = db.prepare(
        "SELECT * FROM rate_limits WHERE ip = ? ORDER BY lastAttempt DESC LIMIT 1"
      );
      const rateLimit = stmt.get(ip) as RateLimit | undefined;

      if (!rateLimit) {
        return { allowed: true };
      }

      const now = new Date();
      const lastAttempt = new Date(rateLimit.lastAttempt);
      const timeDiff = now.getTime() - lastAttempt.getTime();
      const hoursSinceLastAttempt = timeDiff / (1000 * 60 * 60);

      // If blocked, check if block period has expired
      if (rateLimit.blockedUntil) {
        const blockedUntil = new Date(rateLimit.blockedUntil);
        if (now < blockedUntil) {
          return { allowed: false, blockedUntil, attempts: rateLimit.attempts };
        } else {
          // Block period expired, reset
          this.resetRateLimit(ip);
          return { allowed: true };
        }
      }

      // Reset attempts if more than 24 hours have passed
      if (hoursSinceLastAttempt >= 24) {
        this.resetRateLimit(ip);
        return { allowed: true };
      }

      // Check if too many attempts
      if (rateLimit.attempts >= 5) {
        // Block for 1 hour
        const blockedUntil = new Date(now.getTime() + 60 * 60 * 1000);
        this.blockIP(ip, blockedUntil);
        return { allowed: false, blockedUntil, attempts: rateLimit.attempts };
      }

      return { allowed: true, attempts: rateLimit.attempts };
    });
  }

  static recordAttempt(ip: string): void {
    withRetry(() => {
      const stmt = db.prepare(
        "SELECT * FROM rate_limits WHERE ip = ? ORDER BY lastAttempt DESC LIMIT 1"
      );
      const existing = stmt.get(ip) as RateLimit | undefined;

      if (existing) {
        const updateStmt = db.prepare(
          "UPDATE rate_limits SET attempts = attempts + 1, lastAttempt = CURRENT_TIMESTAMP WHERE ip = ? AND id = ?"
        );
        updateStmt.run(ip, existing.id);
      } else {
        const insertStmt = db.prepare(
          "INSERT INTO rate_limits (ip, attempts) VALUES (?, 1)"
        );
        insertStmt.run(ip);
      }
    });
  }

  static blockIP(ip: string, blockedUntil: Date): void {
    withRetry(() => {
      const stmt = db.prepare(
        "UPDATE rate_limits SET blockedUntil = ? WHERE ip = ?"
      );
      stmt.run(blockedUntil.toISOString(), ip);
    });
  }

  static resetRateLimit(ip: string): void {
    withRetry(() => {
      const stmt = db.prepare("DELETE FROM rate_limits WHERE ip = ?");
      stmt.run(ip);
    });
  }

  static getRateLimitInfo(ip: string): RateLimit | null {
    const stmt = db.prepare(
      "SELECT * FROM rate_limits WHERE ip = ? ORDER BY lastAttempt DESC LIMIT 1"
    );
    return stmt.get(ip) as RateLimit | null;
  }
}

export default db;
