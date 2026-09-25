import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { secret } from "../src/config.js";

test("GitHub links belong to successful exports of the visible Skill version", async (t) => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const maintenance = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    password: secret("PGPASSWORD"),
  });
  await maintenance.connect();
  await maintenance.query(`CREATE SCHEMA ${schema}`);
  const previousOptions = process.env.PGOPTIONS;
  process.env.PGOPTIONS = `-c search_path=${schema}`;
  const { pool } = await import("../src/db.js");
  t.after(async () => {
    await pool.end();
    await maintenance.query(`DROP SCHEMA ${schema} CASCADE`);
    await maintenance.end();
    if (previousOptions === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = previousOptions;
  });
  for (const migration of [
    "001_platform.sql",
    "002_owner_github.sql",
    "003_weekly_github.sql",
    "004_skill_reactions.sql",
  ]) {
    await pool.query(await readFile(`migrations/${migration}`, "utf8"));
  }
  const { emptyMind } = await import("../src/format.js");
  const { publicSkill } = await import("../src/services/discovery.js");
  const { githubPublicationUrl } = await import("../src/services/github-publication.js");
  const { syncGithub } = await import("../src/services/github-sync.js");
  const user = randomUUID(),
    skill = randomUUID(),
    version = randomUUID();
  const content = emptyMind("synced-skill");
  const publication = {
    listed: true,
    download: true,
    github: true,
    memory_ids: [],
    asset_keys: [],
  };
  await pool.query(
    "INSERT INTO users(id,email,password_digest,display_name) VALUES($1,'github-link@example.test','unused','Link test')",
    [user],
  );
  await pool.query(
    "INSERT INTO skills(id,owner_id,slug,name,description,draft,publication,status) VALUES($1,$2,$3,$4,'test',$5,$6,'published')",
    [skill, user, content.slug, content.name, content, publication],
  );
  await pool.query(
    "INSERT INTO skill_versions(id,skill_id,version,content,publication) VALUES($1,$2,$3,$4,$5)",
    [version, skill, content.version, content, publication],
  );
  await pool.query("UPDATE skills SET published_version_id=$1 WHERE id=$2", [
    version,
    skill,
  ]);
  const job = {
    id: randomUUID(),
    user_id: user,
    payload: {
      skill_id: skill,
      version_id: version,
      content,
      target: {
        auth_mode: "owner",
        owner: "example",
        repo: "memories",
        branch: "main",
      },
    },
  };
  await pool.query(
    "INSERT INTO jobs(id,user_id,type,payload) VALUES($1,$2,'github',$3)",
    [job.id, user, job.payload],
  );

  await t.test(
    "no link before success; successful retry returns the exact committed folder",
    async () => {
      assert.equal((await publicSkill(skill, null)).github_url, null);
      const commit = {
        sha: "abc123",
        html_url: "https://github.com/example/memories/commit/abc123",
        commit: { message: `DreamFly publication ${job.id}` },
      };
      const api = {
        git: {
          getRef: async () => ({ data: { object: { sha: commit.sha } } }),
        },
        repos: {
          listCommits: async ({ path }: { path: string }) => {
            assert.equal(
              path,
              `skills/${user}/${skill}/${content.version}/${content.slug}/mind.json`,
            );
            return { data: [commit] };
          },
        },
      };
      // A previously committed retry exercises the real worker without contacting GitHub.
      const result = await syncGithub(job, async () => ({
        repo: { owner: "example", name: "memories" },
        api: api as any,
      }));
      const expected = `https://github.com/example/memories/tree/abc123/skills/${user}/${skill}/${content.version}/${content.slug}`;
      assert.equal(result.skill_url, expected);
      for (const status of ["queued", "running", "failed", "skipped"]) {
        await pool.query("UPDATE jobs SET status=$1,result=$2 WHERE id=$3", [
          status,
          result,
          job.id,
        ]);
        assert.equal((await publicSkill(skill, null)).github_url, null);
      }
      await pool.query(
        "UPDATE jobs SET status='succeeded',result=$1 WHERE id=$2",
        [result, job.id],
      );
      assert.equal((await publicSkill(skill, null)).github_url, expected);
      assert.equal(await githubPublicationUrl(skill, version), expected);
      assert.equal(await githubPublicationUrl(randomUUID(), version), null);
      // Old successful jobs still expose their existing commit URL without a data migration.
      await pool.query("UPDATE jobs SET result=$1 WHERE id=$2", [
        { commit_url: commit.html_url },
        job.id,
      ]);
      assert.equal(
        (await publicSkill(skill, null)).github_url,
        commit.html_url,
      );
    },
  );

  await t.test(
    "updated or hidden publications do not expose a stale GitHub link",
    async () => {
      const nextVersion = randomUUID();
      await pool.query(
        "INSERT INTO skill_versions(id,skill_id,version,content,publication) VALUES($1,$2,'1.0.1',$3,$4)",
        [nextVersion, skill, { ...content, version: "1.0.1" }, publication],
      );
      await pool.query(
        "UPDATE skills SET published_version_id=$1 WHERE id=$2",
        [nextVersion, skill],
      );
      assert.equal((await publicSkill(skill, null)).github_url, null);
      assert.equal(await githubPublicationUrl(skill, null), null);
      await pool.query("UPDATE skills SET status='draft' WHERE id=$1", [skill]);
      await assert.rejects(() => publicSkill(skill, null), {
        code: "NOT_FOUND",
      });
    },
  );
});
