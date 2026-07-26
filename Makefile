EXT = .so
# https://sqlite.org/download.html
YEAR := 2026
SQLITE_VERSION := 3530400

SQLITE_SOURCE_URL = https://sqlite.org/$(YEAR)/sqlite-src-$(SQLITE_VERSION).zip
SQLITE_SOURCE_PATH = deps/sqlite-src-$(SQLITE_VERSION)
SQLITE_AMALGAMATION_URL = https://sqlite.org/$(YEAR)/sqlite-amalgamation-$(SQLITE_VERSION).zip
SQLITE_AMALGAMATION_PATH = deps/sqlite-amalgamation-$(SQLITE_VERSION)

override CFLAGS += -I. -I$(SQLITE_SOURCE_PATH)/ext/fts5 -I$(SQLITE_AMALGAMATION_PATH) -O3 -march=native -Wall -Wextra
CONDITIONAL_CFLAGS = -lm

UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
	EXT = .dylib
	# handle macOS path re-linking
	override CFLAGS += -Wl,-headerpad_max_install_names
endif

.PHONY: all clean test

prefix=dist
$(prefix):
	mkdir -p $(prefix)

TARGET_LOADABLE=$(prefix)/better-trigram$(EXT)
TARGET_FTS5=$(prefix)/fts5$(EXT)

all: test loadable
loadable: $(TARGET_LOADABLE)

clean-all: clean
	rm -rf deps

clean:
	rm -rf deps
	rm -rf $(prefix)
	rm -f fold-table.h fold-diacritic-table.h

$(SQLITE_SOURCE_PATH):
	@echo Downloading SQLite source...
	curl -LsS $(SQLITE_SOURCE_URL) -o sqlite-src.zip
	@echo Extracting SQLite source...
	unzip -q sqlite-src.zip -d deps/
	rm -f sqlite-src.zip

$(SQLITE_AMALGAMATION_PATH):
	@echo Downloading SQLite amalgamation...
	wget -q $(SQLITE_AMALGAMATION_URL) -O sqlite.zip
	@echo Extracting SQLite amalgamation...
	unzip sqlite.zip -d deps/
	rm -f sqlite.zip

FOLD_TABLES = fold-table.h fold-diacritic-table.h

$(TARGET_LOADABLE): $(SQLITE_SOURCE_PATH) $(SQLITE_AMALGAMATION_PATH) $(FOLD_TABLES) $(prefix)
	$(CC) $(CFLAGS) $(CONDITIONAL_CFLAGS) -shared -fPIC -o $@ better-trigram.c

$(FOLD_TABLES): gen-fold-table.c $(SQLITE_SOURCE_PATH)
	$(CC) $(CFLAGS) -o gen-fold-table gen-fold-table.c $(CONDITIONAL_CFLAGS)
	./gen-fold-table
	rm -f gen-fold-table

$(TARGET_FTS5): $(SQLITE_SOURCE_PATH) $(SQLITE_AMALGAMATION_PATH) $(prefix)
	dir=$(SQLITE_SOURCE_PATH) \
	cwd=$$(pwd); \
	lemon $$dir/ext/fts5/fts5parse.y; \
	cd $$dir/ext/fts5; \
	tclsh $$cwd/$$dir/ext/fts5/tool/mkfts5c.tcl; \
	cd $$cwd; \
	$(CC) $(CFLAGS) $(CONDITIONAL_CFLAGS) -DSQLITE_TEST -shared -fPIC -o $@ $$dir/ext/fts5/fts5.c; \

test: $(TARGET_FTS5) $(TARGET_LOADABLE)
	bun test
