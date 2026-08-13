#include "ch32fun.h"
#include "rv003usb.h"

#ifndef BUFFERING_CAT_HARDWARE_REV
#define BUFFERING_CAT_HARDWARE_REV 11
#endif

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "dev"
#endif

#ifndef FIRMWARE_GIT_HASH
#define FIRMWARE_GIT_HASH 0x00000000u
#endif

#if BUFFERING_CAT_HARDWARE_REV == 10
#define FIRMWARE_HARDWARE_ID 0x10
#define A0 PA1
#define A1 PD4
#define A2 PA2
#define C0 PD0
#define C1 PC7
#define C2 PC0
#elif BUFFERING_CAT_HARDWARE_REV == 11
#define FIRMWARE_HARDWARE_ID 0x11
/* KiCad v1.1: four independent anodes by two cathode rows. */
#define A0 PC0
#define A1 PD4
#define A2 PC1
#define A3 PA1
#define C0 PC2
#define C1 PA2
#else
#error "BUFFERING_CAT_HARDWARE_REV must be 10 (v1.0) or 11 (v1.1)"
#endif

#define HID_REPORT_ID 0x01
#define HID_REPORT_BYTES 16
#define HID_PAYLOAD_BYTES (HID_REPORT_BYTES - 1)

#define CMD_SET_MASK 0x01
#define CMD_SET_ANIMATION 0x02
#define CMD_OFF 0x03
#define CMD_PING 0x04
#define STATUS_REPLY 0x81

#define ANIMATION_STATIC 0
#define ANIMATION_CHASE 1
#define ANIMATION_REVERSE 2
#define ANIMATION_BOUNCE 3
#define ANIMATION_BLINK 4
#define ANIMATION_FILL 5
#define ANIMATION_RANDOM 6
#define ANIMATION_CHASE_TRAIL 7
#define ANIMATION_BREATHE 8

#define PROTOCOL_VERSION 2
#define LED_SLOT_TICKS Ticks_from_Us(125)
#define LED_MIN_PULSE_TICKS Ticks_from_Us(2)

/* Kept immediately after the reset/interrupt vectors in flash. */
static const char copyright_notice[][16]
	__attribute__((section(".copyright"), used, aligned(1))) =
{
	"     _          ",
	"  |\\'/-..--.    ",
	" / _ _   ,  ;   ",
	"`~=`Y'~_<._./   ",
	" <`-....__.'    ",
	"Buffering Cat | ",
	"Created by      ",
	"Zhixuan |       ",
	"https://github. ",
	"com/zhixuan2333/",
	"buffering_cat   ",
};

static const char firmware_version[]
	__attribute__((section(".copyright"), used, aligned(1))) =
	"FW:" FIRMWARE_VERSION;
static const uint32_t firmware_git_hash
	__attribute__((section(".copyright"), used, aligned(1))) =
	FIRMWARE_GIT_HASH;
static const uint8_t firmware_hardware_revision
	__attribute__((section(".copyright"), used, aligned(1))) =
	FIRMWARE_HARDWARE_ID;

static volatile uint8_t hid_rx[HID_REPORT_BYTES] __attribute__((aligned(4)));
static volatile uint8_t hid_report_pending;
static volatile uint8_t hid_rx_payload_only;
static uint8_t hid_status[HID_REPORT_BYTES] __attribute__((aligned(4)));

static uint8_t base_mask;
static uint8_t visible_mask;
static uint8_t animation_mode;
static uint8_t brightness = 255;
static uint16_t animation_interval_ms = 120;
static uint8_t animation_position;
static int8_t animation_direction = 1;
static uint16_t random_state = 0x5a37;

static uint8_t scan_cursor = 7;
static uint8_t led_is_lit;
static uint8_t led_has_blank_deadline;
static uint32_t next_led_slot_tick;
static uint32_t led_blank_tick;
static uint32_t next_animation_tick;

static uint8_t led_brightness(uint8_t position);

static void leds_off(void)
{
	funDigitalWrite(A0, FUN_LOW);
	funDigitalWrite(A1, FUN_LOW);

#if BUFFERING_CAT_HARDWARE_REV == 10
	/* A2 is shared with the D3/D6 cathode node in the current PCB. */
	funPinMode(A2, GPIO_CNF_IN_FLOATING);
	funDigitalWrite(A2, FUN_LOW);

	/* Floating unused columns prevents R3-fed ghost current into D7/D8. */
	funPinMode(C0, GPIO_CNF_IN_FLOATING);
	funPinMode(C1, GPIO_CNF_IN_FLOATING);
	funPinMode(C2, GPIO_CNF_IN_FLOATING);
	funDigitalWrite(C0, FUN_LOW);
	funDigitalWrite(C1, FUN_LOW);
	funDigitalWrite(C2, FUN_LOW);
#else
	funDigitalWrite(A2, FUN_LOW);
	funDigitalWrite(A3, FUN_LOW);
	funPinMode(C0, GPIO_CNF_IN_FLOATING);
	funPinMode(C1, GPIO_CNF_IN_FLOATING);
	funDigitalWrite(C0, FUN_LOW);
	funDigitalWrite(C1, FUN_LOW);
#endif
}

static void enable_sink(uint32_t pin)
{
	/* The output latch is preloaded low before output mode is enabled. */
	funPinMode(pin, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
}

static void light_led(uint8_t led)
{
	leds_off();

#if BUFFERING_CAT_HARDWARE_REV == 10
	switch (led) {
	case 1:
		enable_sink(C0);
		funDigitalWrite(A0, FUN_HIGH);
		break;
	case 2:
		enable_sink(C1);
		funDigitalWrite(A0, FUN_HIGH);
		break;
	case 3:
		enable_sink(C2);
		funDigitalWrite(A0, FUN_HIGH);
		break;
	case 4:
		enable_sink(C0);
		funDigitalWrite(A1, FUN_HIGH);
		break;
	case 5:
		enable_sink(C1);
		funDigitalWrite(A1, FUN_HIGH);
		break;
	case 6:
		enable_sink(C2);
		funDigitalWrite(A1, FUN_HIGH);
		break;
	case 7:
		funPinMode(A2, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
		funDigitalWrite(A2, FUN_HIGH);
		enable_sink(C0);
		break;
	case 8:
		funPinMode(A2, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
		funDigitalWrite(A2, FUN_HIGH);
		enable_sink(C1);
		break;
	default:
		break;
	}
#else
	switch (led) {
	case 1:
		enable_sink(C0);
		funDigitalWrite(A0, FUN_HIGH);
		break;
	case 2:
		enable_sink(C0);
		funDigitalWrite(A1, FUN_HIGH);
		break;
	case 3:
		enable_sink(C0);
		funDigitalWrite(A2, FUN_HIGH);
		break;
	case 4:
		enable_sink(C0);
		funDigitalWrite(A3, FUN_HIGH);
		break;
	case 5:
		enable_sink(C1);
		funDigitalWrite(A0, FUN_HIGH);
		break;
	case 6:
		enable_sink(C1);
		funDigitalWrite(A1, FUN_HIGH);
		break;
	case 7:
		enable_sink(C1);
		funDigitalWrite(A2, FUN_HIGH);
		break;
	case 8:
		enable_sink(C1);
		funDigitalWrite(A3, FUN_HIGH);
		break;
	default:
		break;
	}
#endif
}

static void led_gpio_init(void)
{
	funGpioInitAll();

	funDigitalWrite(A0, FUN_LOW);
	funDigitalWrite(A1, FUN_LOW);
	funDigitalWrite(A2, FUN_LOW);
#if BUFFERING_CAT_HARDWARE_REV == 11
	funDigitalWrite(A3, FUN_LOW);
#endif
	funDigitalWrite(C0, FUN_LOW);
	funDigitalWrite(C1, FUN_LOW);
#if BUFFERING_CAT_HARDWARE_REV == 10
	funDigitalWrite(C2, FUN_LOW);
#endif

	funPinMode(A0, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
	funPinMode(A1, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
#if BUFFERING_CAT_HARDWARE_REV == 10
	funPinMode(A2, GPIO_CNF_IN_FLOATING);
#else
	funPinMode(A2, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
	funPinMode(A3, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
#endif
	funPinMode(C0, GPIO_CNF_IN_FLOATING);
	funPinMode(C1, GPIO_CNF_IN_FLOATING);
#if BUFFERING_CAT_HARDWARE_REV == 10
	funPinMode(C2, GPIO_CNF_IN_FLOATING);
#endif
}

static uint32_t brightness_pulse_ticks(uint8_t value)
{
	uint32_t ticks;

	ticks = ((uint32_t)LED_SLOT_TICKS * value + 254u) / 255u;
	if (ticks < LED_MIN_PULSE_TICKS) {
		ticks = LED_MIN_PULSE_TICKS;
	}
	if (ticks >= LED_SLOT_TICKS) {
		ticks = LED_SLOT_TICKS - 1;
	}
	return ticks;
}

static void start_led_slot(void)
{
	uint8_t level;

	scan_cursor = (scan_cursor + 1) & 7;

	leds_off();
	led_is_lit = 0;
	led_has_blank_deadline = 0;
	level = led_brightness(scan_cursor);
	if (!level) {
		return;
	}

	light_led(scan_cursor + 1);
	led_is_lit = 1;
	if (level < 255) {
		led_blank_tick = SysTick->CNT + brightness_pulse_ticks(level);
		led_has_blank_deadline = 1;
	}
}

static uint8_t next_enabled(uint8_t from, int8_t direction)
{
	uint8_t i;
	uint8_t position = from;

	for (i = 0; i < 8; ++i) {
		position = (position + direction) & 7;
		if (base_mask & (1u << position)) {
			return position;
		}
	}
	return 0;
}

static uint8_t scaled_brightness(uint8_t value, uint8_t scale)
{
	return ((uint16_t)value * scale + 127u) / 255u;
}

static uint8_t breathe_scale(void)
{
	uint8_t phase = animation_position & 63u;
	uint8_t ramp = phase < 32 ? phase : 63u - phase;
	uint16_t square = (uint16_t)ramp * ramp;

	/* A quadratic curve looks smoother than a linear triangle to the eye. */
	return 8u + ((uint32_t)247u * square + 480u) / 961u;
}

static uint8_t led_brightness(uint8_t position)
{
	uint8_t previous;

	if (!brightness || !(visible_mask & (1u << position))) {
		return 0;
	}
	if (animation_mode != ANIMATION_CHASE_TRAIL) {
		return animation_mode == ANIMATION_BREATHE ?
			scaled_brightness(brightness, breathe_scale()) : brightness;
	}

	if (position == animation_position) {
		return brightness;
	}
	previous = next_enabled(animation_position, -1);
	if (position == previous) {
		return scaled_brightness(brightness, 160);
	}
	previous = next_enabled(previous, -1);
	if (position == previous) {
		return scaled_brightness(brightness, 64);
	}
	return 0;
}

static uint8_t chase_trail_mask(void)
{
	uint8_t mask;
	uint8_t previous;

	if (!base_mask) {
		return 0;
	}
	mask = 1u << animation_position;
	previous = next_enabled(animation_position, -1);
	mask |= 1u << previous;
	previous = next_enabled(previous, -1);
	mask |= 1u << previous;
	return mask;
}

static uint8_t first_enabled(void)
{
	uint8_t i;
	for (i = 0; i < 8; ++i) {
		if (base_mask & (1u << i)) {
			return i;
		}
	}
	return 0;
}

static uint8_t last_enabled(void)
{
	int8_t i;
	for (i = 7; i >= 0; --i) {
		if (base_mask & (1u << i)) {
			return (uint8_t)i;
		}
	}
	return 0;
}

static void reset_animation(void)
{
	animation_position = first_enabled();
	animation_direction = 1;
	next_animation_tick = SysTick->CNT + Ticks_from_Ms(animation_interval_ms);

	switch (animation_mode) {
	case ANIMATION_STATIC:
		visible_mask = base_mask;
		break;
	case ANIMATION_BLINK:
		visible_mask = base_mask;
		break;
	case ANIMATION_FILL:
		visible_mask = base_mask ? (1u << animation_position) : 0;
		break;
	case ANIMATION_CHASE_TRAIL:
		visible_mask = chase_trail_mask();
		break;
	case ANIMATION_BREATHE:
		animation_position = 0;
		visible_mask = base_mask;
		break;
	default:
		visible_mask = base_mask ? (1u << animation_position) : 0;
		break;
	}
}

static void update_animation(void)
{
	uint8_t first;
	uint8_t last;

	if (animation_mode == ANIMATION_STATIC || !base_mask) {
		return;
	}

	switch (animation_mode) {
	case ANIMATION_CHASE:
		animation_position = next_enabled(animation_position, 1);
		visible_mask = 1u << animation_position;
		break;
	case ANIMATION_REVERSE:
		animation_position = next_enabled(animation_position, -1);
		visible_mask = 1u << animation_position;
		break;
	case ANIMATION_BOUNCE:
		first = first_enabled();
		last = last_enabled();
		if (animation_position >= last) {
			animation_direction = -1;
		} else if (animation_position <= first) {
			animation_direction = 1;
		}
		animation_position = next_enabled(animation_position, animation_direction);
		visible_mask = 1u << animation_position;
		break;
	case ANIMATION_BLINK:
		visible_mask = visible_mask ? 0 : base_mask;
		break;
	case ANIMATION_FILL:
		animation_position = next_enabled(animation_position, 1);
		if (visible_mask == base_mask) {
			visible_mask = 1u << first_enabled();
		} else {
			visible_mask |= 1u << animation_position;
		}
		break;
	case ANIMATION_RANDOM:
		random_state = (random_state >> 1) ^ (-(random_state & 1u) & 0xb400u);
		animation_position = next_enabled((uint8_t)random_state, 1);
		visible_mask = 1u << animation_position;
		break;
	case ANIMATION_CHASE_TRAIL:
		animation_position = next_enabled(animation_position, 1);
		visible_mask = chase_trail_mask();
		break;
	case ANIMATION_BREATHE:
		animation_position = (animation_position + 1) & 63u;
		visible_mask = base_mask;
		break;
	default:
		animation_mode = ANIMATION_STATIC;
		visible_mask = base_mask;
		break;
	}
}

static void process_hid_report(void)
{
	uint8_t command = hid_rx[1];
	uint16_t interval;

	if (hid_rx[0] != HID_REPORT_ID) {
		return;
	}

	switch (command) {
	case CMD_SET_MASK:
		base_mask = hid_rx[2];
		brightness = hid_rx[3];
		animation_mode = ANIMATION_STATIC;
		reset_animation();
		break;
	case CMD_SET_ANIMATION:
		animation_mode = hid_rx[2];
		if (animation_mode > ANIMATION_BREATHE) {
			animation_mode = ANIMATION_STATIC;
		}
		base_mask = hid_rx[3];
		brightness = hid_rx[4];
		interval = (uint16_t)hid_rx[5] | ((uint16_t)hid_rx[6] << 8);
		animation_interval_ms = interval < 10 ? 10 :
			(interval > 30000 ? 30000 : interval);
		reset_animation();
		break;
	case CMD_OFF:
		base_mask = 0;
		visible_mask = 0;
		animation_mode = ANIMATION_STATIC;
		leds_off();
		led_is_lit = 0;
		led_has_blank_deadline = 0;
		break;
	case CMD_PING:
	default:
		break;
	}
}

static void update_status_report(void)
{
	hid_status[0] = HID_REPORT_ID;
	hid_status[1] = STATUS_REPLY;
	hid_status[2] = base_mask;
	hid_status[3] = visible_mask;
	hid_status[4] = animation_mode;
	hid_status[5] = brightness;
	hid_status[6] = animation_interval_ms & 0xff;
	hid_status[7] = animation_interval_ms >> 8;
	hid_status[8] = animation_position;
	hid_status[9] = PROTOCOL_VERSION;
	hid_status[10] = rv003usb_internal_data.my_address;
	hid_status[11] = FIRMWARE_HARDWARE_ID;
	hid_status[12] = FIRMWARE_GIT_HASH & 0xff;
	hid_status[13] = (FIRMWARE_GIT_HASH >> 8) & 0xff;
	hid_status[14] = (FIRMWARE_GIT_HASH >> 16) & 0xff;
	hid_status[15] = (FIRMWARE_GIT_HASH >> 24) & 0xff;
}

static void reboot_to_usb_bootloader(void)
{
	leds_off();
	Delay_Ms(5);
	FLASH->BOOT_MODEKEYR = FLASH_KEY1;
	FLASH->BOOT_MODEKEYR = FLASH_KEY2;
	FLASH->STATR = 1u << 14;
	FLASH->CTLR = CR_LOCK_Set;
	RCC->RSTSCKR |= 0x1000000;
	PFIC->SCTLR = 1u << 31;
	while (1) {
	}
}

int main(void)
{
	uint32_t now;

	SystemInit();
	led_gpio_init();
	leds_off();

	/* Force a disconnect pulse when the mandatory external D- pull-up exists. */
	funDigitalWrite(PD2, FUN_LOW);
	funPinMode(PD2, GPIO_Speed_10MHz | GPIO_CNF_OUT_PP);
	Delay_Ms(20);
	funPinMode(PD2, GPIO_CNF_IN_FLOATING);

	usb_setup();
	next_led_slot_tick = SysTick->CNT + LED_SLOT_TICKS;
	next_animation_tick = SysTick->CNT + Ticks_from_Ms(animation_interval_ms);
	update_status_report();

	while (1) {
		if (hid_report_pending) {
			hid_report_pending = 0;
			if (hid_rx[0] == 0xfd && hid_rx[1] == 0x12 &&
				hid_rx[2] == 0x34 && hid_rx[3] == 0xaa &&
				hid_rx[4] == 0xbb && hid_rx[5] == 0xcc &&
				hid_rx[6] == 0xdd) {
				reboot_to_usb_bootloader();
			}
			process_hid_report();
			update_status_report();
		}

		now = SysTick->CNT;
		if (TimeElapsed32(now, next_led_slot_tick) >= 0) {
			next_led_slot_tick += LED_SLOT_TICKS;
			if (TimeElapsed32(now, next_led_slot_tick) >= 0) {
				/* Do not burst through missed slots after a long USB interrupt. */
				next_led_slot_tick = now + LED_SLOT_TICKS;
			}
			start_led_slot();
		}

		now = SysTick->CNT;
		if (led_is_lit && led_has_blank_deadline &&
			TimeElapsed32(now, led_blank_tick) >= 0) {
			leds_off();
			led_is_lit = 0;
			led_has_blank_deadline = 0;
		}

		if (animation_mode != ANIMATION_STATIC &&
			TimeElapsed32(now, next_animation_tick) >= 0) {
			next_animation_tick += Ticks_from_Ms(animation_interval_ms);
			update_animation();
			update_status_report();
		}
	}
}

void usb_handle_user_in_request(struct usb_endpoint *e, uint8_t *scratchpad,
	int endpoint, uint32_t send_token, struct rv003usb_internal *state)
{
	(void)e;
	(void)scratchpad;
	(void)state;
	if (endpoint) {
		usb_send_empty(send_token);
	}
}

void usb_handle_user_data(struct usb_endpoint *e, int endpoint, uint8_t *data,
	int length, struct rv003usb_internal *state)
{
	int offset;
	int remaining;
	int i;

	(void)endpoint;
	(void)state;
	offset = e->count << 3;
	if (offset == 0 && hid_rx[0] == 0xfd) {
		/* hidapi includes report ID in data; WebHID passes it in wValue. */
		hid_rx_payload_only = data[0] == 0xfd ? 0 : 1;
	}
	remaining = (int)e->max_len - offset;
	if (remaining > length) {
		remaining = length;
	}
	if (remaining <= 0) {
		return;
	}

	for (i = 0; i < remaining && offset + i + hid_rx_payload_only < HID_REPORT_BYTES; ++i) {
		hid_rx[offset + i + hid_rx_payload_only] = data[i];
	}
	e->count++;
	if ((e->count << 3) >= e->max_len) {
		hid_report_pending = 1;
	}
}

void usb_handle_hid_get_report_start(struct usb_endpoint *e, int request_length,
	uint32_t value_index)
{
	uint8_t report_id = value_index & 0xff;

	if (report_id != HID_REPORT_ID) {
		e->max_len = 0;
		return;
	}
	if (request_length > HID_REPORT_BYTES) {
		request_length = HID_REPORT_BYTES;
	}
	/* WebHID may request only the payload; hidapi includes the report ID. */
	e->opaque = request_length == HID_PAYLOAD_BYTES ? hid_status + 1 : hid_status;
	e->max_len = request_length;
}

void usb_handle_hid_set_report_start(struct usb_endpoint *e, int request_length,
	uint32_t value_index)
{
	uint8_t i;
	uint8_t report_id = value_index & 0xff;

	for (i = 0; i < HID_REPORT_BYTES; ++i) {
		hid_rx[i] = 0;
	}
	hid_rx[0] = report_id;
	hid_rx_payload_only = request_length == HID_PAYLOAD_BYTES || report_id == 0xfd;
	if (request_length > HID_REPORT_BYTES) {
		request_length = HID_REPORT_BYTES;
	}
	e->max_len = request_length;
}

void usb_handle_other_control_message(struct usb_endpoint *e,
	struct usb_urb *request, struct rv003usb_internal *state)
{
	(void)e;
	(void)request;
	(void)state;
}
