import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class InitialSchema1731510000000 implements MigrationInterface {
  name = 'InitialSchema1731510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'user_id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'birth_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'image_path',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'password',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'role',
            type: 'enum',
            enum: ['EMPLOYEE', 'ADMIN'],
            default: "'EMPLOYEE'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            precision: 6,
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_97672ac88f789774dd47f7c8be',
        columnNames: ['email'],
        isUnique: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'invited',
        columns: [
          {
            name: 'token',
            type: 'varchar',
            length: '36',
            isPrimary: true,
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'role',
            type: 'enum',
            enum: ['EMPLOYEE', 'ADMIN'],
            default: "'EMPLOYEE'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'invited',
      new TableIndex({
        name: 'IDX_INVITED_EMAIL',
        columnNames: ['email'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'tasks',
        columns: [
          {
            name: 'task_id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'start_date',
            type: 'datetime',
            isNullable: false,
          },
          {
            name: 'end_date',
            type: 'datetime',
            isNullable: false,
          },
          {
            name: 'started_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'submitted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'completed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'],
            default: "'UNASSIGNED'",
          },
          {
            name: 'assigned_to',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            precision: 6,
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'tasks',
      new TableForeignKey({
        columnNames: ['assigned_to'],
        referencedColumnNames: ['user_id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'comment',
        columns: [
          {
            name: 'comment_id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'content',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'userId',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'taskId',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            precision: 6,
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'comment',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['user_id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'comment',
      new TableForeignKey({
        columnNames: ['taskId'],
        referencedColumnNames: ['task_id'],
        referencedTableName: 'tasks',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('comment', true);
    await queryRunner.dropTable('tasks', true);
    await queryRunner.dropTable('invited', true);
    await queryRunner.dropTable('users', true);
  }
}
