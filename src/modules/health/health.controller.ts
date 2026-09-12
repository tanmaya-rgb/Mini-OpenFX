import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    // Deliberately no DB/Redis ping here yet — that arrives once the DB
    // module exists (step 2), so a deploy platform can use this as an
    // early "process is up" check even before dependencies are wired.
    return { status: 'ok', service: 'miniopenfx', timestamp: new Date().toISOString() };
  }
}
