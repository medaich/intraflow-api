import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../src/app.module";
import * as fs from "fs";
import * as path from "path";

async function exportOpenApi() {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
  const app = await NestFactory.create(AppModule, { logger: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Intraflow API")
    .setDescription("Role-based task coordination and internal operations API")
    .setVersion("1.0")
    .addCookieAuth("session", {
      type: "apiKey",
      in: "cookie",
      name: "session",
      description: "Signed session cookie",
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  const docsDir = path.resolve(__dirname, "../docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, "openapi.json");
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), "utf8");
  console.log(`OpenAPI specification exported successfully to ${outputPath}`);

  await app.close();
  process.exit(0);
}

exportOpenApi().catch((err) => {
  console.error("Failed to export OpenAPI document:", err);
  process.exit(1);
});
