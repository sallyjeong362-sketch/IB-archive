# 수업자료 아카이브 (IB-archive)

선생님들이 함께 수업 자료를 등록하고, 실제 진행한 활동을 기록하고, 서로 댓글로 의견을 나눌 수 있는 공유 아카이브입니다.

## 주요 기능

- 📘 **교재(표지 이미지) → 📂 유닛 → 📄 자료** 3단계 폴더 구조로 자료를 정리
- 📖 수업에 쓰인 텍스트/내용 기록
- ✅ 실제 진행한 활동 설명 기록
- 📎 파일 업로드 (문서, PPT, PDF 등)
- 🖼️ 이미지 업로드 (갤러리로 표시)
- 🔗 외부 링크 연결 (유튜브 링크는 자동으로 영상이 임베드됩니다)
- 🎯 IB PYP 탐구단원(색깔별)/영역(Central Idea 등)/학습자상 10가지 태그
- 💬 게시물마다 댓글로 다른 선생님과 의견 공유
- 🔍 제목/내용/과목·태그/탐구단원/영역/학습자상으로 검색 및 필터 (현재 열어본 유닛 안에서 동작)
- 실시간 동기화: 한 선생님이 교재/유닛/자료를 등록하거나 댓글을 달면 다른 선생님 화면에도 바로 반영됩니다.

빌드 과정이 필요 없는 순수 HTML/CSS/JS 정적 사이트이며, 데이터 저장과 실시간 공유를 위해 [Firebase](https://firebase.google.com/) 무료 요금제(Spark)를 사용합니다.

## 처음 설정하기 (한 번만 하면 됩니다)

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 새 프로젝트를 만듭니다.
2. 왼쪽 메뉴 **Firestore Database** → "데이터베이스 만들기" (프로덕션 모드로 시작해도 됩니다. 리전은 아무 곳이나 선택 가능).
3. 왼쪽 메뉴 **Storage** → "시작하기"로 활성화합니다. (파일/이미지 업로드용)
4. 왼쪽 메뉴 **Authentication** → "시작하기" → Sign-in method 탭에서 **익명(Anonymous)** 제공업체를 사용 설정합니다. (이름을 입력하는 것만으로 이용할 수 있도록, 로그인 화면 없이 백그라운드에서 익명 인증을 사용합니다.)
5. 프로젝트 설정(톱니바퀴 아이콘) → 일반 탭 → "내 앱" → 웹 앱 추가(`</>`) → 앱 닉네임 입력 후 등록. 이때 나오는 `firebaseConfig` 객체(`apiKey`, `authDomain` 등)를 복사해둡니다.
6. 이 저장소의 [`firestore.rules`](./firestore.rules) 내용을 Firebase 콘솔 → Firestore Database → 규칙 탭에 붙여넣고 **게시**합니다.
7. 이 저장소의 [`storage.rules`](./storage.rules) 내용을 Firebase 콘솔 → Storage → 규칙 탭에 붙여넣고 **게시**합니다.
8. 앱(`index.html`)을 열면 나오는 설정 화면에 5번에서 복사한 `firebaseConfig`를 그대로 붙여넣고 "연결하고 시작하기"를 누릅니다. 이후 이름(별명)을 한 번 입력하면 바로 사용할 수 있습니다.

> 설정을 바꾸고 싶다면 앱 오른쪽 위 "연결 설정" 버튼을 누르면 다시 입력할 수 있습니다.

## 다른 선생님께 공유하기

설정값은 브라우저(localStorage)마다 따로 저장되어서, 다른 기기·브라우저에서는 원래 이 설정 과정을 다시 거쳐야 합니다. 매번 `firebaseConfig`를 손으로 붙여넣는 건 특히 휴대폰에서 번거로우니, 앱에 연결한 뒤 오른쪽 위 **"🔗 공유 링크 복사"** 버튼을 누르면 설정값이 통째로 담긴 링크가 복사됩니다. 이 링크를 다른 선생님께 보내드리면, 그 링크를 여는 것만으로 별도 설정 없이 바로 이름 입력 화면으로 넘어갑니다.

> 이 링크에는 Firebase 프로젝트 접속 정보가 포함되어 있지만, 이 값들은 브라우저에서 누구나 볼 수 있는 공개 클라이언트 설정값이라(비밀번호 아님) 실제 접근 제어는 Firestore/Storage 보안 규칙이 담당합니다. 다만 링크가 아무나에게나 공개되면 원치 않는 사람도 자료를 올리거나 볼 수 있으니, 우리 학교/학년 선생님들에게만 전달해주세요.

> **보안 규칙을 바꾼 뒤에는** (이 저장소의 `firestore.rules`/`storage.rules` 파일이 업데이트된 경우) Firebase 콘솔에서도 다시 붙여넣고 게시해야 실제로 반영됩니다 — 코드는 GitHub Pages로 자동 배포되지만, 보안 규칙은 콘솔에서 직접 게시하는 별도 단계입니다.

## 로컬에서 미리보기

빌드 도구가 필요 없어 정적 파일 서버만 있으면 됩니다.

```bash
npx serve .
# 또는
python3 -m http.server 8080
```

## GitHub Pages로 배포하기

`main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml` 워크플로가 자동으로 GitHub Pages에 배포합니다. 저장소 설정(Settings → Pages)에서 Source를 **GitHub Actions**로 지정해주세요.

## 데이터 구조 (Firestore)

교재 &gt; 유닛 &gt; 자료 &gt; 댓글 순서로 중첩된 구조입니다.

- `textbooks/{textbookId}`: `name`, `coverUrl`, `coverPath`, `authorName`, `authorUid`, `createdAt`
- `textbooks/{textbookId}/units/{unitId}`: `name`, `authorName`, `authorUid`, `createdAt`
- `.../units/{unitId}/posts/{postId}`: `title`, `tags[]`, `uoi`, `categories[]`, `learnerProfile[]`, `lessonText`, `actionDescription`, `files[]`, `images[]`, `links[]`, `authorName`, `authorUid`, `createdAt`
- `.../posts/{postId}/comments/{commentId}`: `text`, `authorName`, `authorUid`, `createdAt`

교재 표지 이미지는 Storage의 `textbook-covers/{textbookId}/...` 경로에, 자료 첨부파일/이미지는 `uploads/{textbookId}/{unitId}/{postId}/...` 경로에 저장되고, 다운로드 URL만 Firestore 문서에 저장됩니다.

> 이전 버전(교재/유닛 구조 도입 전)에 등록했던 테스트 게시물은 `posts` 최상위 컬렉션에 남아있으며 새 구조에서는 보이지 않습니다. 필요하면 Firebase 콘솔의 Firestore Database에서 직접 확인하거나 삭제할 수 있습니다.

## 권한 정책

- 모든 자료와 댓글은 누구나 읽을 수 있습니다(같은 Firebase 프로젝트에 연결된 선생님들 전용).
- 자료/댓글 삭제는 작성자 본인만 가능합니다 (익명 인증 UID 기준, 같은 브라우저를 계속 사용해야 유지됩니다).
