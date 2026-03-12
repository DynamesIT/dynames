import os
import glob

chars_to_fix = [
    'à', 'è', 'é', 'ì', 'ò', 'ù',
    'À', 'È', 'É', 'Ì', 'Ò', 'Ù',
    'á', 'í', 'ó', 'ú', 'ý', 'ï',
    '’', '‘', '“', '”', '«', '»',
    '–', '—', '…', '°', '·', '©', '®', '™'
]

reps = {}
for c in chars_to_fix:
    try:
        mojibake = c.encode('utf-8').decode('cp1252')
        reps[mojibake] = c
    except Exception as e:
        print(f"Could not map {c}: {e}")

def fix_mojibake(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    fixed_content = content
    for bad, good in reps.items():
        fixed_content = fixed_content.replace(bad, good)
        
    # Manual patch for stripped Right Double Quotation Mark which has \x9d in it
    fixed_content = fixed_content.replace('â€<', '”<')
    fixed_content = fixed_content.replace('â€\n', '”\n')
    fixed_content = fixed_content.replace('â€\r', '”\r')

    # Altri fix ad hoc
    fixed_content = fixed_content.replace('PerchÃ©', 'Perché')
    
    if content != fixed_content:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(fixed_content)
        print(f"Fixed {file_path}")

print("Inizio correzione encoding...")
files = glob.glob('c:/Users/gbran/Desktop/Intelligence website/intelligence-portal/**/*.html', recursive=True)
for f in files:
    fix_mojibake(f)
print("Finito.")
