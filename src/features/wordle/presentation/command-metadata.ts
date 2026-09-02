export const WORDLE_COMMAND = {
    name: "워들",
    description: "워들이나 합시다.",
    subcommands: {
        play: {
            name: "플레이",
            description: "오늘의 Wordle 플레이 화면을 표시합니다.",
        },
        input: {
            name: "입력",
            description: "모달 없이 단어를 입력하고 플레이 화면을 표시합니다.",
            guessOption: {
                name: "단어",
                description: "바로 제출할 5글자 영단어",
                minLength: 5,
                maxLength: 5,
            },
        },
        share: {
            name: "공유",
            description: "사용자의 현재 플레이 현황 또는 결과를 채팅으로 공유합니다.",
        },
        scoreboard: {
            name: "점수판",
            description: "현재 서버의 오늘 Wordle 점수판을 표시합니다.",
        },
        records: {
            name: "통계",
            description: "사용자 개인 통계 또는 현재 서버의 통계를 표시합니다.",
            userOption: {
                name: "사용자",
                description: "개인 통계을 확인할 사용자입니다. 생략하면 서버 통계를 표시합니다.",
            },
        },
        refreshTest: {
            name: "갱신_test",
            description: "오늘의 Wordle 정답 캐시를 강제로 갱신합니다.",
        },
        yesterdayRecordTest: {
            name: "어제기록_test",
            description: "어제의 Wordle 기록판을 테스트합니다.",
        },
    },
} as const;
