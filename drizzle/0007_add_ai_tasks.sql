CREATE TABLE `ai_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`shot_id` integer,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`media_type` text DEFAULT 'video' NOT NULL,
	`mode` text,
	`prompt` text,
	`task_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`result_urls` text,
	`error` text,
	`created_at` integer,
	`updated_at` integer
);
