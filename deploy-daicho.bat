@echo off
rem 台帳のサーバーのプログラム「だけ」を Firebase に入れる（資材便のプログラムにはさわらない。HANDOFF 4-0）
rem ただの firebase deploy は使わない
cd /d "%~dp0"
firebase deploy --only functions:daicho --project yotsuba-daicho
pause
