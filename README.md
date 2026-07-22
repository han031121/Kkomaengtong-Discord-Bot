# 꼬맹통 Discord 봇

TypeScript와 discord.js로 만든 간단한 Discord 슬래시 명령어 봇입니다. 메시지 내용을 읽지 않으므로 `Message Content Intent` 없이 실행할 수 있습니다.

이 프로젝트의 초기 구조와 예제 코드는 OpenAI Codex를 사용하여 생성되었습니다.

## 포함된 기능

- `/핑`: 봇의 WebSocket 응답 속도 확인
- `/서버`: 현재 서버 이름, ID, 멤버 수 확인
- `/사용자`: 내 Discord 계정 정보 확인
- `/도움말`: 사용할 수 있는 명령어 안내
- 환경 변수 유효성 검사
- ESLint, Prettier, TypeScript, Vitest 기반 품질 검사
- GitHub Actions CI

## 준비 사항

- Node.js 22 이상
- npm 11 이상
- Discord 계정 및 테스트용 Discord 서버

## 시작하기

1. 의존성을 설치합니다.

    ```powershell
    npm install
    ```

2. [Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션과 봇을 만듭니다.

3. 예제 환경 변수 파일을 복사합니다.

    ```powershell
    Copy-Item .env.example .env
    ```

4. `.env`에 다음 값을 입력합니다.

    ```dotenv
    DISCORD_TOKEN=봇-토큰
    DISCORD_CLIENT_ID=애플리케이션-ID
    DISCORD_GUILD_ID=개발용-서버-ID
    ```

    `DISCORD_GUILD_ID`는 선택 사항입니다. 개발 중에는 서버 ID를 지정하는 편이 명령어가 즉시 반영되어 편리합니다. 비워 두면 전역 명령어로 등록됩니다.

5. Developer Portal의 OAuth2 URL 생성기에서 `bot`과 `applications.commands` 범위를 선택하여 봇을 서버에 초대합니다. 현재 예제 명령어에는 별도의 관리자 권한이 필요하지 않습니다.

6. 슬래시 명령어를 Discord에 등록합니다. 명령어 정의를 변경할 때도 이 명령을 다시 실행해야 합니다.

    ```powershell
    npm run deploy:commands
    ```

7. 개발 모드로 봇을 실행합니다. 소스가 바뀌면 자동으로 다시 시작됩니다.

    ```powershell
    npm run dev
    ```

## 프로젝트 구조

```text
.
├── .github/workflows/ci.yml   # GitHub Actions 품질 검사
├── src/
│   ├── bot/create-client.ts   # Discord 클라이언트와 이벤트 처리
│   ├── commands/              # 슬래시 명령어 모듈
│   ├── config/env.ts          # 환경 변수 검증
│   ├── types/command.ts       # 공통 명령어 타입
│   ├── deploy-commands.ts     # Discord API 명령어 등록
│   └── index.ts               # 애플리케이션 진입점
├── tests/                     # Vitest 테스트
├── .env.example               # 환경 변수 예시
├── eslint.config.js           # 정적 분석 설정
├── prettier.config.js         # 코드 포맷 설정
└── tsconfig.json              # TypeScript 컴파일 설정
```

새 명령어는 `src/commands`에 `BotCommand` 타입으로 작성한 후 `src/commands/index.ts`의 `commands` 배열에 추가합니다.

## 개발 명령어

| 명령어                    | 용도                                |
| ------------------------- | ----------------------------------- |
| `npm run dev`             | 파일 변경을 감지하며 개발 서버 실행 |
| `npm run deploy:commands` | 슬래시 명령어를 Discord에 등록      |
| `npm run check`           | 린트, 포맷, 타입, 테스트 전체 검사  |
| `npm test`                | 테스트 한 번 실행                   |
| `npm run test:watch`      | 테스트 감시 모드 실행               |
| `npm run format`          | 프로젝트 파일 자동 포맷             |
| `npm run build`           | `dist` 디렉터리에 운영용 코드 빌드  |
| `npm start`               | 빌드된 운영용 코드 실행             |

운영 실행 전에는 다음 순서를 사용합니다.

```powershell
npm run check
npm run build
npm start
```

## 보안 주의 사항

- `.env`와 봇 토큰은 Git에 커밋하지 않습니다.
- 토큰이 노출되었다면 Developer Portal에서 즉시 재발급합니다.
- 봇에는 실제 기능에 필요한 최소 권한만 부여합니다.
