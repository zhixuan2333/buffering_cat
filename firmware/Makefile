TARGET := buffering_cat
TARGET_MCU := CH32V003

# 10 = PCB v1.0, 11 = PCB v1.1. The current KiCad design is v1.1.
HARDWARE_REV ?= 11
FIRMWARE_VERSION ?= dev
GIT_HASH ?= 00000000

# Override this on the command line if ch32fun is checked out elsewhere.
CH32FUN ?= ../../ch32fun/ch32fun
RV003USB ?= ../../rv003usb
LINKER_SCRIPT := generated_ch32v003.ld
EXTRA_CFLAGS += -Icompat -I$(RV003USB)/lib -I$(RV003USB)/rv003usb
EXTRA_CFLAGS += -DBUFFERING_CAT_HARDWARE_REV=$(HARDWARE_REV)
EXTRA_CFLAGS += -DFIRMWARE_VERSION='"$(FIRMWARE_VERSION)"'
EXTRA_CFLAGS += -DFIRMWARE_GIT_HASH=0x$(GIT_HASH)
ADDITIONAL_C_FILES += $(RV003USB)/rv003usb/rv003usb.S
ADDITIONAL_C_FILES += $(RV003USB)/rv003usb/rv003usb.c

all: build

bootloader:
	$(MAKE) -C usb_bootloader

include $(CH32FUN)/ch32fun.mk

# Keep generated files inside this project instead of modifying ch32fun.
GENERATED_LD_FILE := $(LINKER_SCRIPT)

$(LINKER_SCRIPT): $(CH32FUN)/ch32fun.ld copyright-section.awk
	$(PREFIX)-gcc -E -P -x c \
		-DTARGET_MCU=$(TARGET_MCU) \
		-DMCU_PACKAGE=$(MCU_PACKAGE) \
		-DTARGET_MCU_LD=$(TARGET_MCU_LD) \
		-DTARGET_MCU_MEMORY_SPLIT=$(TARGET_MCU_MEMORY_SPLIT) \
		$< | awk -f copyright-section.awk > $@

flash: cv_flash
clean: cv_clean

.PHONY: all bootloader flash clean
