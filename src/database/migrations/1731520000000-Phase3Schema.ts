import { MigrationInterface, QueryRunner } from "typeorm";

export class Phase3Schema1731520000000 implements MigrationInterface {
  name = 'Phase3Schema1731520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`team_memberships\` (\`id\` int NOT NULL AUTO_INCREMENT, \`user_id\` int NOT NULL, \`team_id\` int NOT NULL, \`role\` enum ('MEMBER', 'MODERATOR') NOT NULL DEFAULT 'MEMBER', \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`UQ_team_memberships_user_id\` (\`user_id\`), UNIQUE INDEX \`REL_c9eb2ded8e0e2f4bcb41fd0984\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`teams\` (\`team_id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, \`description\` text NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, UNIQUE INDEX \`IDX_48c0c32e6247a2de155baeaf98\` (\`name\`), PRIMARY KEY (\`team_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`projects\` (\`project_id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) NOT NULL, \`description\` text NULL, \`start_date\` date NULL, \`end_date\` date NULL, \`status\` enum ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE', \`team_id\` int NULL, \`created_by\` int NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, PRIMARY KEY (\`project_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`task_dependencies\` (\`task_id\` int NOT NULL, \`depends_on_task_id\` int NOT NULL, INDEX \`IDX_1ae6688b1bd90fffe857f4cb70\` (\`task_id\`), INDEX \`IDX_26dedda08faccdb95aff99e112\` (\`depends_on_task_id\`), PRIMARY KEY (\`task_id\`, \`depends_on_task_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(`ALTER TABLE \`tasks\` ADD \`project_id\` int NULL`);
    await queryRunner.query(`ALTER TABLE \`invited\` ADD \`team_id\` int NULL`);
    await queryRunner.query(
      `ALTER TABLE \`comment\` ADD \`is_system\` tinyint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`team_memberships\` ADD CONSTRAINT \`FK_c9eb2ded8e0e2f4bcb41fd0984a\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`team_memberships\` ADD CONSTRAINT \`FK_b917b8603c6d5c526fcdb2009de\` FOREIGN KEY (\`team_id\`) REFERENCES \`teams\`(\`team_id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`projects\` ADD CONSTRAINT \`FK_ce17f8b1c8016554cafa2dc8fb5\` FOREIGN KEY (\`team_id\`) REFERENCES \`teams\`(\`team_id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`projects\` ADD CONSTRAINT \`FK_8a7ccdb94bcc8635f933c8f8080\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`user_id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tasks\` ADD CONSTRAINT \`FK_9eecdb5b1ed8c7c2a1b392c28d4\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`project_id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`invited\` ADD CONSTRAINT \`FK_d95f38058737eb8dcd6b48c4740\` FOREIGN KEY (\`team_id\`) REFERENCES \`teams\`(\`team_id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`task_dependencies\` ADD CONSTRAINT \`FK_1ae6688b1bd90fffe857f4cb707\` FOREIGN KEY (\`task_id\`) REFERENCES \`tasks\`(\`task_id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE \`task_dependencies\` ADD CONSTRAINT \`FK_26dedda08faccdb95aff99e112e\` FOREIGN KEY (\`depends_on_task_id\`) REFERENCES \`tasks\`(\`task_id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`task_dependencies\` DROP FOREIGN KEY \`FK_26dedda08faccdb95aff99e112e\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`task_dependencies\` DROP FOREIGN KEY \`FK_1ae6688b1bd90fffe857f4cb707\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`invited\` DROP FOREIGN KEY \`FK_d95f38058737eb8dcd6b48c4740\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tasks\` DROP FOREIGN KEY \`FK_9eecdb5b1ed8c7c2a1b392c28d4\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`projects\` DROP FOREIGN KEY \`FK_8a7ccdb94bcc8635f933c8f8080\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`projects\` DROP FOREIGN KEY \`FK_ce17f8b1c8016554cafa2dc8fb5\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`team_memberships\` DROP FOREIGN KEY \`FK_b917b8603c6d5c526fcdb2009de\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`team_memberships\` DROP FOREIGN KEY \`FK_c9eb2ded8e0e2f4bcb41fd0984a\``,
    );
    await queryRunner.query(`ALTER TABLE \`invited\` DROP COLUMN \`team_id\``);
    await queryRunner.query(`ALTER TABLE \`tasks\` DROP COLUMN \`project_id\``);
    await queryRunner.query(`ALTER TABLE \`comment\` DROP COLUMN \`is_system\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_26dedda08faccdb95aff99e112\` ON \`task_dependencies\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_1ae6688b1bd90fffe857f4cb70\` ON \`task_dependencies\``,
    );
    await queryRunner.query(`DROP TABLE \`task_dependencies\``);
    await queryRunner.query(`DROP TABLE \`projects\``);
    await queryRunner.query(`DROP INDEX \`IDX_48c0c32e6247a2de155baeaf98\` ON \`teams\``);
    await queryRunner.query(`DROP TABLE \`teams\``);
    await queryRunner.query(
      `DROP INDEX \`REL_c9eb2ded8e0e2f4bcb41fd0984\` ON \`team_memberships\``,
    );
    await queryRunner.query(
      `DROP INDEX \`UQ_team_memberships_user_id\` ON \`team_memberships\``,
    );
    await queryRunner.query(`DROP TABLE \`team_memberships\``);
  }
}
