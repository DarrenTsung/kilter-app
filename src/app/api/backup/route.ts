import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const BACKUP_DIR = join(process.cwd(), "data", "backups");

async function ensureDir() {
  await mkdir(BACKUP_DIR, { recursive: true });
}

/** POST — save a backup to disk */
export async function POST(request: NextRequest) {
  try {
    await ensureDir();
    const body = await request.json();

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "-",
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join("");
    const filename = `kilter-backup-${timestamp}.json`;
    const filepath = join(BACKUP_DIR, filename);

    await writeFile(filepath, JSON.stringify(body), "utf-8");

    return NextResponse.json({ filename });
  } catch (err) {
    console.error("[backup] POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save backup" },
      { status: 500 },
    );
  }
}

/** GET — list backups or return a specific backup file */
export async function GET(request: NextRequest) {
  try {
    await ensureDir();
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");

    if (file) {
      // Prevent path traversal
      const safeName = file.replace(/[^a-zA-Z0-9._-]/g, "");
      const filepath = join(BACKUP_DIR, safeName);
      const content = await readFile(filepath, "utf-8");
      return new NextResponse(content, {
        headers: { "Content-Type": "application/json" },
      });
    }

    // List all backup files, newest first
    const files = await readdir(BACKUP_DIR);
    const backups = files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    return NextResponse.json({ backups });
  } catch (err) {
    console.error("[backup] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read backups" },
      { status: 500 },
    );
  }
}
