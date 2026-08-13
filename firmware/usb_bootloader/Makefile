TARGET := buffering_cat_bootloader
TARGET_MCU := CH32V003

CH32FUN ?= ../../../ch32fun/ch32fun
RV003USB ?= ../../../rv003usb

SYSTEM_C :=
ADDITIONAL_C_FILES += $(RV003USB)/rv003usb/rv003usb.S
EXTRA_CFLAGS += -I../compat -I. -I$(RV003USB) -I$(RV003USB)/lib -I$(RV003USB)/rv003usb
EXTRA_CFLAGS += -DUSE_TINY_BOOT
LINKER_SCRIPT := $(RV003USB)/bootloader/ch32v003fun-usb-bootloader.ld
WRITE_SECTION := bootloader

all: build

include $(CH32FUN)/ch32fun.mk

clean: cv_clean

.PHONY: all clean
