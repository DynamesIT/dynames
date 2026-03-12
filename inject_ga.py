import os
import glob

gtag_snippet = """    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-DFL8MJSKVJ"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'G-DFL8MJSKVJ');
    </script>"""

def inject_gtag(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'googletagmanager.com/gtag/js' in content:
        print(f"Already injected in {file_path}")
        return

    # Trova il tag <head>
    head_tag_pos = content.find('<head>')
    if head_tag_pos != -1:
        # Inserisci snippet subito dopo <head>
        insertion_pos = head_tag_pos + len('<head>\n')
        new_content = content[:insertion_pos] + gtag_snippet + '\n' + content[insertion_pos:]
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Injected in {file_path}")
    else:
        print(f"No <head> tag found in {file_path}")

files = glob.glob('c:/Users/gbran/Desktop/Intelligence website/intelligence-portal/**/*.html', recursive=True)
for f in files:
    inject_gtag(f)
print("Finished injecting Google Analytics.")
