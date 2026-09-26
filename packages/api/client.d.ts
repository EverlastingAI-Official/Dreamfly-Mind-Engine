import type { ApiRoutes } from './routes.js';
import type { ExistingMessageDto, MessageEventHandler, UserDto } from './dto.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type WithoutQuery<P extends string> = P extends `${infer Path}?${string}` ? Path : P;
type SegmentMatches<Pattern, Value> = Pattern extends `:${string}`
  ? true
  : Pattern extends Value
    ? true
    : false;
type PathMatches<
  Pattern extends string,
  Path extends string,
> = Pattern extends `${infer Head}/${infer Tail}`
  ? Path extends `${infer Part}/${infer Rest}`
    ? SegmentMatches<Head, Part> extends true
      ? PathMatches<Tail, Rest>
      : false
    : false
  : Path extends `${string}/${string}`
    ? false
    : SegmentMatches<Pattern, Path>;
type RouteKey<M extends Method, P extends string> = {
  [K in keyof ApiRoutes]: K extends `${M} ${infer Pattern}`
    ? PathMatches<Pattern, WithoutQuery<P>> extends true
      ? K
      : never
    : never;
}[keyof ApiRoutes];
type Options<M extends Method, K extends keyof ApiRoutes> = Omit<RequestInit, 'body' | 'method'> &
  (M extends 'GET' ? { method?: M } : { method: M }) &
  ([ApiRoutes[K]['body']] extends [never] ? { body?: never } : { body: ApiRoutes[K]['body'] }) &
  (ApiRoutes[K]['response'] extends Blob ? { download: true } : { download?: false });

export interface ApiCall {
  <P extends string, M extends Method = 'GET', K extends keyof ApiRoutes = RouteKey<M, P>>(
    path: P,
    ...args: [K] extends [never]
      ? [options: never]
      : M extends 'GET'
        ? ApiRoutes[K]['response'] extends Blob
          ? [options: Options<M, K>]
          : [options?: Options<M, K>]
        : [options: Options<M, K>]
  ): Promise<ApiRoutes[K]['response']>;
}
export interface ClientSession {
  user: UserDto | null;
  csrf: string;
}
export interface ClientOptions {
  base: string;
  session: () => ClientSession;
  clearSession: () => void;
  fetch?: typeof fetch;
}
export interface ApiClient {
  api: ApiCall;
  sendMessage(
    conversation: string,
    content: string,
    onEvent: MessageEventHandler,
    signal?: AbortSignal,
  ): Promise<ExistingMessageDto | void>;
}
