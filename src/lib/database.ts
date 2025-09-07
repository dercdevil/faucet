import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "faucet.db");
const db = new Database(dbPath);

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
    const stmt = db.prepare("INSERT INTO claims (ip, wallet) VALUES (?, ?)");
    stmt.run(ip, wallet);
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
  }

  static recordAttempt(ip: string): void {
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
  }

  static blockIP(ip: string, blockedUntil: Date): void {
    const stmt = db.prepare(
      "UPDATE rate_limits SET blockedUntil = ? WHERE ip = ?"
    );
    stmt.run(blockedUntil.toISOString(), ip);
  }

  static resetRateLimit(ip: string): void {
    const stmt = db.prepare("DELETE FROM rate_limits WHERE ip = ?");
    stmt.run(ip);
  }

  static getRateLimitInfo(ip: string): RateLimit | null {
    const stmt = db.prepare(
      "SELECT * FROM rate_limits WHERE ip = ? ORDER BY lastAttempt DESC LIMIT 1"
    );
    return stmt.get(ip) as RateLimit | null;
  }
}

export default db;
