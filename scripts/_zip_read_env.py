import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
print(z.read('hanork-bot/.env').decode('utf-8', errors='replace'))
