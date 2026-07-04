CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`company_name` text NOT NULL,
	`job_title` text NOT NULL,
	`job_type` text DEFAULT 'new_grad' NOT NULL,
	`season` text,
	`location` text,
	`work_mode` text DEFAULT 'unknown' NOT NULL,
	`job_url` text,
	`portal_url` text,
	`date_applied` text,
	`status` text DEFAULT 'interested' NOT NULL,
	`resume_id` text,
	`cover_letter_id` text,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`next_action_date` text,
	`next_action_note` text,
	`discovered_job_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cover_letter_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `applications_status_idx` ON `applications` (`status`);--> statement-breakpoint
CREATE INDEX `applications_company_idx` ON `applications` (`company_name`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`careers_url` text,
	`ats` text,
	`ats_config` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_name_unique` ON `companies` (`name`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`email` text,
	`username` text,
	`encrypted_password` text,
	`encryption_iv` text,
	`encryption_salt` text,
	`encryption_version` integer,
	`encrypted_notes` text,
	`notes_iv` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_application_unique` ON `credentials` (`application_id`);--> statement-breakpoint
CREATE TABLE `discovered_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`dedupe_key` text NOT NULL,
	`company` text NOT NULL,
	`company_id` text,
	`title` text NOT NULL,
	`location` text,
	`url` text NOT NULL,
	`season` text,
	`role_type` text DEFAULT 'unknown' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`posted_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`saved_application_id` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovered_jobs_dedupe_unique` ON `discovered_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `discovered_jobs_company_idx` ON `discovered_jobs` (`company`);--> statement-breakpoint
CREATE INDEX `discovered_jobs_seen_idx` ON `discovered_jobs` (`first_seen_at`);--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version_label` text DEFAULT 'v1' NOT NULL,
	`target_role` text,
	`storage_key` text,
	`storage_driver` text,
	`file_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scraper_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`companies_scanned` integer DEFAULT 0 NOT NULL,
	`jobs_found` integer DEFAULT 0 NOT NULL,
	`new_jobs` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `status_events_application_idx` ON `status_events` (`application_id`);