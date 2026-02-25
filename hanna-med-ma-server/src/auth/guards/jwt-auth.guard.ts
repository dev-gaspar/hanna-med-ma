import { Injectable, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthGuard } from "@nestjs/passport";
import { Observable } from "rxjs";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private configService: ConfigService) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();

    // Check for API key in header (for n8n and service-to-service calls)
    const apiKey = request.headers["x-api-key"];
    const serverApiKey = this.configService.get<string>("SERVER_API_KEY");

    if (apiKey && serverApiKey && apiKey === serverApiKey) {
      return true; // Bypass JWT auth if API key is valid
    }

    return super.canActivate(context);
  }
}
