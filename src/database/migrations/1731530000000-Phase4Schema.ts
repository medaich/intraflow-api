import { MigrationInterface, QueryRunner } from "typeorm";

export class Phase4Schema1731530000000 implements MigrationInterface {
  name = "Phase4Schema1731530000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add priority enum column to tasks (LOW, MEDIUM, HIGH, URGENT)
    await queryRunner.query(
      "ALTER TABLE `tasks` ADD `priority` enum ('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM'",
    );

    // 2. Add sessions_valid_from column to users
    await queryRunner.query(
      "ALTER TABLE `users` ADD `sessions_valid_from` timestamp(6) NULL",
    );

    // 3. Create password_reset_tokens table
    await queryRunner.query(
      "CREATE TABLE `password_reset_tokens` (" +
        "`id` int NOT NULL AUTO_INCREMENT, " +
        "`user_id` int NOT NULL, " +
        "`token_hash` varchar(64) NOT NULL, " +
        "`expires_at` timestamp(6) NOT NULL, " +
        "`used_at` timestamp(6) NULL DEFAULT NULL, " +
        "`created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), " +
        "INDEX `idx_password_reset_tokens_token_hash` (`token_hash`), " +
        "INDEX `idx_password_reset_tokens_user_id` (`user_id`), " +
        "PRIMARY KEY (`id`)" +
        ") ENGINE=InnoDB",
    );

    // 4. Create email_change_requests table
    await queryRunner.query(
      "CREATE TABLE `email_change_requests` (" +
        "`id` int NOT NULL AUTO_INCREMENT, " +
        "`user_id` int NOT NULL, " +
        "`new_email` varchar(255) NOT NULL, " +
        "`token_hash` varchar(64) NOT NULL, " +
        "`expires_at` timestamp(6) NOT NULL, " +
        "`used_at` timestamp(6) NULL DEFAULT NULL, " +
        "`created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), " +
        "INDEX `idx_email_change_requests_token_hash` (`token_hash`), " +
        "INDEX `idx_email_change_requests_user_id` (`user_id`), " +
        "PRIMARY KEY (`id`)" +
        ") ENGINE=InnoDB",
    );

    // 5. Create attachments table
    await queryRunner.query(
      "CREATE TABLE `attachments` (" +
        "`attachment_id` int NOT NULL AUTO_INCREMENT, " +
        "`task_id` int NOT NULL, " +
        "`uploaded_by` int NULL DEFAULT NULL, " +
        "`original_name` varchar(255) NOT NULL, " +
        "`storage_key` varchar(255) NOT NULL, " +
        "`content_type` varchar(100) NOT NULL, " +
        "`size` int NOT NULL, " +
        "`created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), " +
        "UNIQUE INDEX `IDX_ec3648b85f6af7eafe865a3257` (`storage_key`), " +
        "INDEX `idx_attachments_task_id` (`task_id`), " +
        "PRIMARY KEY (`attachment_id`)" +
        ") ENGINE=InnoDB",
    );

    // Foreign Keys
    await queryRunner.query(
      "ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `FK_52ac39dd8a28730c63aeb428c9c` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE NO ACTION",
    );
    await queryRunner.query(
      "ALTER TABLE `email_change_requests` ADD CONSTRAINT `FK_45b3391d341b1a58def2881e8c2` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE NO ACTION",
    );
    await queryRunner.query(
      "ALTER TABLE `attachments` ADD CONSTRAINT `FK_e62fd181b97caa6b150b09220b1` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`task_id`) ON DELETE CASCADE ON UPDATE NO ACTION",
    );
    await queryRunner.query(
      "ALTER TABLE `attachments` ADD CONSTRAINT `FK_e25812e3fd9b3f3edf11b2c5d58` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE NO ACTION",
    );

    // 6. Indexes for filters and sorting
    // Tasks indexes
    await queryRunner.query("CREATE INDEX `idx_tasks_status` ON `tasks` (`status`)");
    await queryRunner.query("CREATE INDEX `idx_tasks_dates` ON `tasks` (`end_date`, `start_date`)");
    await queryRunner.query("CREATE INDEX `idx_tasks_priority` ON `tasks` (`priority`)");
    await queryRunner.query("CREATE INDEX `idx_tasks_project_status` ON `tasks` (`project_id`, `status`)");
    await queryRunner.query("CREATE INDEX `idx_tasks_assigned_to` ON `tasks` (`assigned_to`)");
    await queryRunner.query("CREATE INDEX `idx_tasks_name` ON `tasks` (`name`)");

    // Users indexes
    await queryRunner.query("CREATE INDEX `idx_users_role` ON `users` (`role`)");
    await queryRunner.query("CREATE INDEX `idx_users_name` ON `users` (`name`)");

    // Projects indexes
    await queryRunner.query("CREATE INDEX `idx_projects_name` ON `projects` (`name`)");
    await queryRunner.query("CREATE INDEX `idx_projects_dates` ON `projects` (`end_date`, `start_date`)");
    await queryRunner.query("CREATE INDEX `idx_projects_status` ON `projects` (`status`)");
    await queryRunner.query("CREATE INDEX `idx_projects_team_id` ON `projects` (`team_id`)");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop projects indexes
    await queryRunner.query(
      "ALTER TABLE `projects` DROP FOREIGN KEY `FK_ce17f8b1c8016554cafa2dc8fb5`",
    );
    await queryRunner.query("DROP INDEX `idx_projects_team_id` ON `projects`");
    await queryRunner.query(
      "ALTER TABLE `projects` ADD CONSTRAINT `FK_ce17f8b1c8016554cafa2dc8fb5` FOREIGN KEY (`team_id`) REFERENCES `teams`(`team_id`) ON DELETE SET NULL ON UPDATE NO ACTION",
    );
    await queryRunner.query("DROP INDEX `idx_projects_status` ON `projects`");
    await queryRunner.query("DROP INDEX `idx_projects_dates` ON `projects`");
    await queryRunner.query("DROP INDEX `idx_projects_name` ON `projects`");

    // Drop users indexes
    await queryRunner.query("DROP INDEX `idx_users_name` ON `users`");
    await queryRunner.query("DROP INDEX `idx_users_role` ON `users`");

    // Drop tasks indexes
    await queryRunner.query("DROP INDEX `idx_tasks_name` ON `tasks`");
    await queryRunner.query(
      "ALTER TABLE `tasks` DROP FOREIGN KEY `FK_5770b28d72ca90c43b1381bf787`",
    );
    await queryRunner.query("DROP INDEX `idx_tasks_assigned_to` ON `tasks`");
    await queryRunner.query(
      "ALTER TABLE `tasks` ADD CONSTRAINT `FK_5770b28d72ca90c43b1381bf787` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE NO ACTION",
    );
    await queryRunner.query(
      "ALTER TABLE `tasks` DROP FOREIGN KEY `FK_9eecdb5b1ed8c7c2a1b392c28d4`",
    );
    await queryRunner.query("DROP INDEX `idx_tasks_project_status` ON `tasks`");
    await queryRunner.query(
      "ALTER TABLE `tasks` ADD CONSTRAINT `FK_9eecdb5b1ed8c7c2a1b392c28d4` FOREIGN KEY (`project_id`) REFERENCES `projects`(`project_id`) ON DELETE SET NULL ON UPDATE NO ACTION",
    );
    await queryRunner.query("DROP INDEX `idx_tasks_priority` ON `tasks`");
    await queryRunner.query("DROP INDEX `idx_tasks_dates` ON `tasks`");
    await queryRunner.query("DROP INDEX `idx_tasks_status` ON `tasks`");

    // Drop foreign keys
    await queryRunner.query(
      "ALTER TABLE `attachments` DROP FOREIGN KEY `FK_e25812e3fd9b3f3edf11b2c5d58`",
    );
    await queryRunner.query(
      "ALTER TABLE `attachments` DROP FOREIGN KEY `FK_e62fd181b97caa6b150b09220b1`",
    );
    await queryRunner.query(
      "ALTER TABLE `email_change_requests` DROP FOREIGN KEY `FK_45b3391d341b1a58def2881e8c2`",
    );
    await queryRunner.query(
      "ALTER TABLE `password_reset_tokens` DROP FOREIGN KEY `FK_52ac39dd8a28730c63aeb428c9c`",
    );

    // Drop tables
    await queryRunner.query("DROP TABLE `attachments`");
    await queryRunner.query("DROP TABLE `email_change_requests`");
    await queryRunner.query("DROP TABLE `password_reset_tokens`");

    // Drop columns
    await queryRunner.query("ALTER TABLE `users` DROP COLUMN `sessions_valid_from`");
    await queryRunner.query("ALTER TABLE `tasks` DROP COLUMN `priority`");
  }
}
