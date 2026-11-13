# 3D Dino Runner｜方塊恐龍無盡跑酷

使用 React、TypeScript、Tailwind CSS 與 Three.js 建置的 3D 無盡跑酷遊戲。

## 遊戲特色

- **三跑道 3D 跑酷**：支援鍵盤（`A/D`、`←/→`、`W/↑/Space`、`S/↓`）與觸控滑動手勢。
- **每 10 秒自動加速 10%**：獨立計時器驅動速度倍率成長，與金幣加分完全解耦。
- **3D 黃色金幣方塊**：自動避開障礙物生成於安全跑道，吃到即獲得 `+50` 分與 3D 縮放消散特效。
- **動態天氣與閃電系統**：隨分數推進循環切換晴朗、黃昏、細雨與雷雨天氣，並帶有霧效變化、雨絲與閃電雷聲。
- **跑道邊界與粒子拖尾特效**：雙側發光光條與粒子流，搭配跳躍、下蹲與奔跑塵土拖尾粒子。
- **暫停選單與 Web Audio 音效**：按下 `P` / `Esc` 或點擊右上角按鈕隨時暫停與恢復遊戲。

## 本地開發

```bash
npm install
npm run dev
```

## 部署至 GitHub Pages

本專案已內建 GitHub Actions 自動部署設定檔（`.github/workflows/deploy.yml`）與相對路徑打包設定：

1. 將專案推送至 GitHub 儲存庫的 `main` 或 `master` 分支。
2. 前往 GitHub 儲存庫的 **Settings → Pages**。
3. 在 **Build and deployment → Source** 選擇 **GitHub Actions**。
4. 每次推送更新時，GitHub Actions 會自動執行 `npm run build` 並發布至 GitHub Pages。
