import { Global, Module } from "@nestjs/common";
import { StorageService, LocalDiskStorage } from "./storage.service";

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useClass: LocalDiskStorage,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
