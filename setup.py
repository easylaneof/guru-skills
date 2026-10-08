"""Install the local environment and verify rendering, without paid API requests."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


def main():
    if sys.version_info < (3, 10):
        raise SystemExit('Нужен Python 3.10 или новее.')
    npm = shutil.which('npm')
    node = shutil.which('node')
    if not npm or not node:
        raise SystemExit('Установите Node.js 22 LTS или новее с npm и повторите python3 setup.py.')
    version = subprocess.check_output([node, '--version'], text=True).strip()
    if int(version.lstrip('v').split('.')[0]) < 22:
        raise SystemExit('Нужен Node.js 22 или новее.')
    python = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.exists():
        venv.create(ROOT / '.venv', with_pip=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'requirements.txt')], check=True)
    subprocess.run([npm, 'ci'], cwd=ROOT / 'remotion', check=True)
    npx = shutil.which('npx')
    if not npx:
        raise SystemExit('Не найден npx из поставки npm.')
    subprocess.run([npx, 'remotion', 'browser', 'ensure'], cwd=ROOT / 'remotion', check=True)
    env_path = ROOT / '.env'
    if not env_path.exists():
        shutil.copyfile(ROOT / '.env.example', env_path)
    subprocess.run([npm, 'run', 'lint'], cwd=ROOT / 'remotion', check=True)
    subprocess.run([str(python), '-m', 'unittest', 'discover', '-s', 'tests'], cwd=ROOT, check=True)
    for fmt in ('1x1', '16x9', '9x16'):
        subprocess.run([str(python), 'helpers/render.py', f'examples/poster-{fmt}.json'], cwd=ROOT, check=True)
    print('Готово. Примеры: output/prochee/example/. Скилл: .agents/skills/photo-creatives/SKILL.md')
    print('Для генерации укажите свой KIE_AI_API_KEY в .env. Ключ не нужен для наложения текста.')


if __name__ == '__main__':
    main()
