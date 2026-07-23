# 꼬맹통 Discord 봇

TypeScript와 discord.js로 만든 간단한 Discord 슬래시 명령어 봇입니다. 메시지 내용을 읽지 않으므로 `Message Content Intent` 없이 실행할 수 있습니다.

이 프로젝트의 초기 구조와 예제 코드는 OpenAI Codex를 사용하여 생성되었습니다.

## 포함된 기능

- `/테스트 기능:<선택>`: 명령어 옵션에서 다음 기능 중 하나를 실행
    - 핑: 봇의 WebSocket 응답 속도 확인
    - 서버: 현재 서버 이름, ID, 멤버 수 확인
    - 사용자: 내 Discord 계정 정보 확인
    - 도움말: 사용할 수 있는 테스트 기능 안내
    - 인사: 꼬맹통봇과 인사
- `/워들 키워드:<5글자 영단어>`: 오늘의 NYT Wordle 플레이
    - 첫 입력으로 사용자별 게임과 채널 구성원 모두가 볼 수 있는 일반 메시지 패널 생성
    - 이후 입력은 기존 패널을 수정하며 최대 6회까지 진행
    - 공개 패널에는 색상 타일만 표시하고 소유자 전용 `내 게임 보기` 버튼 제공
    - 비공개 화면에서 색상 추측 기록과 알파벳순 글자 상태를 표시하고 새 화면을 열 때 이전 화면 삭제
    - 정답을 맞힌 결과에서만 결과 공유, 게임 패널 이동, 스포하기 버튼 제공
    - 성공 결과 공유는 완성된 패널을 채널 아래에 한 번 더 게시하고 공유 버튼을 비활성화
    - NYT Wordle 날짜별 엔드포인트에서 서울 기준 오늘의 퍼즐을 조회
    - Free Dictionary API에서 입력 단어를 검증하며 잘못된 단어는 횟수에서 제외
- 환경 변수 유효성 검사
- ESLint, Prettier, TypeScript, Vitest 기반 품질 검사
- GitHub Actions CI

## 준비 사항

- Node.js 22 이상
- npm 11 이상
- Discord 계정 및 테스트용 Discord 서버
- NYT Wordle과 Free Dictionary API에 접속할 수 있는 네트워크 환경

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
│   ├── commands/test.ts       # 기능 선택 옵션과 다섯 테스트 기능
│   ├── commands/wordle.ts     # Wordle 슬래시 명령어와 패널 갱신
│   ├── features/wordle/       # 게임 규칙, 외부 API, 세션 및 패널
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

새 테스트 기능은 `src/commands/test.ts`의 명령어 옵션 선택지와 응답 생성 로직에 함께 추가합니다.

Wordle 진행 상태는 사용자와 퍼즐 날짜별로 봇 프로세스 메모리에 저장됩니다. 따라서 봇을 재시작하면 진행 중인 게임은 초기화되며, 다음 입력에서 새 공개 패널이 생성됩니다. NYT와 사전 응답은 같은 날짜 또는 단어에 대해 프로세스가 실행되는 동안 캐시됩니다.

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
