import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { isAuthorizedRequest } from './access-token';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();

    if (isAuthorizedRequest(process.env.API_ACCESS_TOKEN, request.headers?.authorization)) {
      return true;
    }

    throw new UnauthorizedException('缺少或错误的 API 访问令牌');
  }
}
