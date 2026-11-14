import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @ApiOperation({ summary: "System and database connectivity health check" })
  @ApiResponse({ status: 200, description: "System is healthy" })
  @ApiResponse({ status: 503, description: "Database is unhealthy" })
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck("database"),
    ]);
  }
}
