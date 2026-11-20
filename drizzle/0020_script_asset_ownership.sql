ALTER TABLE assets ADD COLUMN script_id TEXT REFERENCES scripts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ai_tasks ADD COLUMN script_id TEXT REFERENCES scripts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ai_tasks ADD COLUMN purpose TEXT;
--> statement-breakpoint
ALTER TABLE ai_tasks ADD COLUMN composition_id TEXT;
--> statement-breakpoint
ALTER TABLE compositions ADD COLUMN script_id TEXT REFERENCES scripts(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX ai_tasks_project_purpose ON ai_tasks(project_id, purpose);
--> statement-breakpoint
CREATE INDEX assets_project_script_shot ON assets(project_id, script_id, shot_id);
--> statement-breakpoint
UPDATE assets SET script_id = (SELECT min(id) FROM scripts WHERE scripts.project_id=assets.project_id HAVING count(*)=1);
--> statement-breakpoint
UPDATE ai_tasks SET script_id = (SELECT min(id) FROM scripts WHERE scripts.project_id=ai_tasks.project_id HAVING count(*)=1) WHERE shot_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE ai_tasks ADD COLUMN awaiting_asset INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ai_tasks ADD COLUMN delivered_asset_id TEXT;
--> statement-breakpoint
-- Older clone submissions have no explicit purpose. Only adopt the unique known
-- whole-film prompt on a clone project that has never delivered a composition.
UPDATE ai_tasks SET purpose='replicate', status=CASE WHEN status='completed' THEN 'unknown' ELSE status END
WHERE id IN (
  SELECT min(t.id) FROM ai_tasks t JOIN projects p ON p.id=t.project_id
  WHERE p.source_type='clone' AND t.shot_id IS NULL AND t.mode='video-to-video'
    AND t.prompt LIKE '参考 视频1 的运镜、节奏、景别与转场，复刻一条同样风格的带货短视频%'
    AND NOT EXISTS (SELECT 1 FROM compositions c WHERE c.project_id=p.id AND c.status='done')
  GROUP BY t.project_id HAVING count(*)=1
);
