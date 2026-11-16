cmake_minimum_required(VERSION 3.22.1)
project(llama-android)

# مكتبة llama.cpp تُحمَّل وقت البناء (في مجلد llama-src بجذر المستودع، انظر سير العمل)
set(LLAMA_SRC ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../llama-src)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)

add_subdirectory(${LLAMA_SRC} llama-build)

# الغلاف الرسمي لـ llama.cpp على أندرويد (يُنسخ وقت البناء)
add_library(llama-android SHARED llama-android.cpp)
target_link_libraries(llama-android llama common android log)
