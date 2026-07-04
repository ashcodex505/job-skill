import { migrate } from "drizzle-orm/libsql/migrator";
import { db, newId, now, tables } from "./index";
import { syncCompanies } from "@/scraper/run";

/**
 * Demo/seed data: two resumes, four applications across the pipeline with
 * status history, and a handful of discovered jobs. Idempotent-ish: skips if
 * applications already exist. Credentials are NOT seeded — add your own via
 * the UI so they're encrypted with your key.
 */
async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await syncCompanies();

  const existing = await db.select().from(tables.applications).limit(1);
  if (existing.length > 0) {
    console.log("Database already has applications — skipping seed.");
    return;
  }

  const t = now();
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const dateOnly = (n: number) => daysAgo(n).slice(0, 10);

  const resumeA = newId();
  const resumeB = newId();
  await db.insert(tables.resumes).values([
    {
      id: resumeA,
      name: "Ashish Kurse — SWE General",
      versionLabel: "v3",
      targetRole: "Backend SWE",
      notes: "General-purpose resume. Upload the PDF from the Resumes page.",
      tags: JSON.stringify(["general", "backend"]),
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      id: resumeB,
      name: "Ashish Kurse — AI/ML Focus",
      versionLabel: "v1",
      targetRole: "AI/ML",
      notes: "Highlights ML projects and coursework.",
      tags: JSON.stringify(["ml", "ai"]),
      createdAt: daysAgo(12),
      updatedAt: daysAgo(12),
    },
  ]);

  const apps: {
    id: string;
    company: string;
    title: string;
    status: string;
    history: { to: string; note: string | null; at: string }[];
    resumeId: string;
    season: string;
    jobType: string;
    location: string;
    workMode: string;
    applied: string | null;
    nextAction?: { date: string; note: string };
    tags: string[];
  }[] = [
    {
      id: newId(),
      company: "Stripe",
      title: "Software Engineer Intern (Summer 2027)",
      status: "technical_interview",
      resumeId: resumeA,
      season: "Summer 2027",
      jobType: "internship",
      location: "San Francisco, CA",
      workMode: "hybrid",
      applied: dateOnly(21),
      nextAction: { date: dateOnly(-3), note: "Virtual onsite — review payments system design" },
      tags: ["fintech", "priority"],
      history: [
        { to: "applied", note: "Applied via careers page", at: daysAgo(21) },
        { to: "oa_received", note: "HackerRank, 70 min", at: daysAgo(18) },
        { to: "oa_completed", note: "Passed all test cases", at: daysAgo(17) },
        { to: "recruiter_screen", note: "Chat with recruiter went well", at: daysAgo(10) },
        { to: "technical_interview", note: "Scheduled for next week", at: daysAgo(3) },
      ],
    },
    {
      id: newId(),
      company: "Anthropic",
      title: "Software Engineer, New Grad (2027)",
      status: "applied",
      resumeId: resumeB,
      season: "2027 New Grad",
      jobType: "new_grad",
      location: "San Francisco, CA",
      workMode: "hybrid",
      applied: dateOnly(5),
      tags: ["ai"],
      history: [{ to: "applied", note: "Referred by a friend", at: daysAgo(5) }],
    },
    {
      id: newId(),
      company: "NVIDIA",
      title: "Software Engineering Intern, Summer 2027",
      status: "oa_received",
      resumeId: resumeA,
      season: "Summer 2027",
      jobType: "internship",
      location: "Santa Clara, CA",
      workMode: "onsite",
      applied: dateOnly(9),
      nextAction: { date: dateOnly(-1), note: "Complete the coding assessment (72h window)" },
      tags: ["hardware", "priority"],
      history: [
        { to: "applied", note: null, at: daysAgo(9) },
        { to: "oa_received", note: "HackerRank link received", at: daysAgo(1) },
      ],
    },
    {
      id: newId(),
      company: "Meta",
      title: "Software Engineer Intern (Summer 2027)",
      status: "rejected",
      resumeId: resumeA,
      season: "Summer 2027",
      jobType: "internship",
      location: "Menlo Park, CA",
      workMode: "onsite",
      applied: dateOnly(40),
      tags: [],
      history: [
        { to: "applied", note: null, at: daysAgo(40) },
        { to: "rejected", note: "Generic rejection email — reapply next cycle", at: daysAgo(25) },
      ],
    },
  ];

  for (const app of apps) {
    await db.insert(tables.applications).values({
      id: app.id,
      companyName: app.company,
      jobTitle: app.title,
      jobType: app.jobType,
      season: app.season,
      location: app.location,
      workMode: app.workMode,
      dateApplied: app.applied,
      status: app.status,
      resumeId: app.resumeId,
      tags: JSON.stringify(app.tags),
      nextActionDate: app.nextAction?.date ?? null,
      nextActionNote: app.nextAction?.note ?? null,
      createdAt: app.history[0]?.at ?? t,
      updatedAt: app.history.at(-1)?.at ?? t,
    });
    let from: string | null = null;
    for (const event of app.history) {
      await db.insert(tables.statusEvents).values({
        id: newId(),
        applicationId: app.id,
        fromStatus: from,
        toStatus: event.to,
        note: event.note,
        createdAt: event.at,
      });
      from = event.to;
    }
  }

  console.log(`Seeded ${apps.length} applications and 2 resumes.`);
  console.log("Run `npm run scrape` to populate Job Discovery with live postings.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
